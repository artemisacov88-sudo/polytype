import assert from "node:assert/strict";
import type { CachedMetadata, TFile } from "obsidian";
import { PersonalLearningService } from "../personal-learning/learning-service";
import { isEligibleLearningLocation, matchesExcludedPath } from "../personal-learning/eligibility";
import { PersonalModel } from "../personal-learning/personal-model";
import { PersonalizedPredictionProvider } from "../personal-learning/personalized-provider";
import { PersonalModelStorage, type PersonalModelAdapter } from "../personal-learning/storage";
import { classifyAcceptedMarker, detectCompletedTypedWord } from "../personal-learning/typed-word-observer";
import type { PredictionProvider, PredictionRequest } from "../prediction/types";

class MemoryAdapter implements PersonalModelAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		return {
			files: [...this.files.keys()].filter((item) => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes("/")),
			folders: [...this.folders].filter((item) => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes("/")),
		};
	}
	async mkdir(path: string): Promise<void> { this.folders.add(path); }
	async read(path: string): Promise<string> { const value = this.files.get(path); if (value === undefined) throw Error("missing"); return value; }
	async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
	async remove(path: string): Promise<void> { this.files.delete(path); }
}

async function run(): Promise<void> {
	assert.deepEqual(detectCompletedTypedWord("I really like", "I really like "), {
		word: "like", wordStartCh: 9, context: ["i", "really"],
	});
	assert.equal(detectCompletedTypedWord("I really lik", "I really like"), undefined,
		"typing a letter is not a completed word observation");
	assert.equal(detectCompletedTypedWord("", "pasted text "), undefined,
		"paste or bulk insertion is not learned as typed words");
	assert.equal(detectCompletedTypedWord("I can", "I can'"), undefined,
		"apostrophes inside a word do not close the observation");
	const acceptedMarker = {
		line: 3,
		word: "tea",
		wordStartCh: 7,
		acceptedLineText: "I like tea",
	};
	assert.equal(classifyAcceptedMarker(acceptedMarker, 3, "I like tea"), "keep");
	assert.equal(classifyAcceptedMarker(acceptedMarker, 3, "I like tea ",
		detectCompletedTypedWord("I like tea", "I like tea ")), "consume",
		"a later typed delimiter completes the same accepted event only once");
	assert.equal(classifyAcceptedMarker(acceptedMarker, 3, "I like teas ",
		detectCompletedTypedWord("I like teas", "I like teas ")), "discard",
		"a modified word is not mistaken for the accepted suggestion");

	const adapter = new MemoryAdapter();
	const service = new PersonalLearningService(new PersonalModelStorage(adapter, "personal-data"), () => undefined, 60_000);
	await service.load();
	service.setPreferences(true, ["Private", "Templates"]);
	assert.equal(service.recordAcceptedSuggestion("alpha", ["i"], "en", "Private/a.md"), false);
	assert.equal(service.recordAcceptedSuggestion("alpha", ["i"], "en", "notes/a.md"), true);
	assert.equal(service.recordTypedWord("beta", ["i", "prefer"], "en", "notes/a.md"), true);
	assert.equal(adapter.files.size, 0, "updates are batched until flush");
	await service.flush();
	assert.equal(adapter.files.size, 1);
	assert.equal(service.getStatus().acceptedSuggestions, 1);
	assert.equal(service.getStatus().typedWords, 1);
	service.renamePath("notes", "archive");
	assert.equal(service.model.getNoteStatistics("archive/a.md")?.acceptedSuggestions, 1);
	service.forgetPath("archive");
	assert.equal(service.getStatus().acceptedSuggestions, 0);
	assert.equal(service.getStatus().typedWords, 0);
	await service.flush();
	service.setPreferences(false, []);
	assert.equal(service.recordAcceptedSuggestion("beta", ["i"], "en", "notes/a.md"), false);
	await service.reset();
	assert.equal(service.getStatus().fileBytes, 0);
	service.dispose();

	const file = { path: "notes/a.md" } as TFile;
	const normal = { file, cursorLine: 5, cursorCh: 8, lineText: "some prose", metadata: {
		sections: [{ type: "paragraph", position: { start: { line: 4 }, end: { line: 6 } } }],
	} as unknown as CachedMetadata };
	assert.equal(isEligibleLearningLocation(normal), true, "classified ordinary Markdown prose is eligible");
	assert.equal(isEligibleLearningLocation({ ...normal, metadata: null }), false, "missing metadata fails closed");
	assert.equal(isEligibleLearningLocation({ ...normal, metadata: {} as CachedMetadata }), false,
		"metadata without section coverage does not prove prose eligibility");
	assert.equal(isEligibleLearningLocation({ ...normal, file: { path: "Templates/a.md" } as TFile }), false);
	assert.equal(isEligibleLearningLocation({ ...normal, file: { path: ".git/notes/a.md" } as TFile }), false,
		"service directories are excluded by default");
	assert.equal(isEligibleLearningLocation({ ...normal, metadata: {
		frontmatter: { position: { start: { line: 0 }, end: { line: 3 } } },
		sections: [{ type: "yaml", position: { start: { line: 0 }, end: { line: 3 } } }],
	} as unknown as CachedMetadata, cursorLine: 2 }), false, "YAML frontmatter is excluded");
	assert.equal(isEligibleLearningLocation({ ...normal, metadata: {
		sections: [{ type: "code", position: { start: { line: 4 }, end: { line: 9 } } }],
	} as unknown as CachedMetadata }), false, "fenced code is excluded");
	assert.equal(isEligibleLearningLocation({ ...normal, lineText: "code `inside", cursorCh: 12,
		textBeforeCursor: "code `inside" }), false, "inline code is excluded");
	const longInlineCodeLine = `\`${"x".repeat(700)} prose`;
	assert.equal(isEligibleLearningLocation({ ...normal, lineText: longInlineCodeLine,
		cursorCh: longInlineCodeLine.length, textBeforeCursor: "prose" }), false,
		"inline-code eligibility uses the current line even when the opener is beyond the bounded observer context");
	assert.equal(isEligibleLearningLocation({ ...normal, lineText: "code `inside` prose", cursorCh: 18,
		textBeforeCursor: "code `inside` prose" }), true, "ordinary Markdown after inline code remains eligible");
	assert.equal(matchesExcludedPath("Private/folder/a.md", "Private/folder"), true);
	assert.equal(matchesExcludedPath("Private-other/a.md", "Private"), false);

	const model = new PersonalModel();
	const baseWords = ["abacus", "abalone", "abandon", "abashed", "abbey"];
	const baseProvider: PredictionProvider = { predict: async (_request: PredictionRequest) => baseWords };
	let enabled = true;
	const personalProvider = new PersonalizedPredictionProvider(baseProvider, () => model, () => enabled);
	const request: PredictionRequest = { language: "en", context: ["i", "really"], currentWord: "ab" };
	for (let index = 0; index < 60; index++) model.registerAcceptedSuggestion("abalone", request.context, "en", "notes/style.md");
	assert.equal((await personalProvider.predict(request))[0], "abalone", "repeated contextual preference can improve the OANC rank");
	assert.equal((await personalProvider.predict({ ...request, maxSuggestions: 2 })).length, 2,
		"personal ranking respects the configured suggestion count");
	const oneObservation = new PersonalModel();
	oneObservation.registerAcceptedSuggestion("abandon", request.context, "en", "notes/one.md");
	const cautiousProvider = new PersonalizedPredictionProvider(baseProvider, () => oneObservation, () => true);
	assert.equal((await cautiousProvider.predict(request))[0], "abacus", "one observation does not displace the base top suggestion");
	enabled = false;
	assert.deepEqual(await personalProvider.predict(request), baseWords, "disabled personalization falls back to the base provider");
	assert.deepEqual(await personalProvider.predict({ ...request, language: "de" }), baseWords,
		"unsupported personal languages retain normal suggestions");

	console.log("Personal learning integration tests passed.");
}

void run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
