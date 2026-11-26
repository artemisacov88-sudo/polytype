import assert from "node:assert/strict";
import { boundedDamerauLevenshtein } from "../spelling/edit-distance";
import { LocalSpellingDictionary, SpellingDictionaryLoader } from "../spelling/dictionary-provider";
import { PersonalSpellingDictionary } from "../spelling/personal-dictionary";
import { SpellingEngine } from "../spelling/spelling-engine";
import type { SpellingSettings } from "../spelling/spelling-types";

const dictionary = new LocalSpellingDictionary("ru", [
	{ word: "работа", frequency: 100, pos: "NOUN" },
	{ word: "работу", frequency: 80, pos: "NOUN" },
	{ word: "привет", frequency: 70, pos: "NOUN" },
]);

assert.equal(dictionary.has("работа"), true);
assert.equal(dictionary.has("раобта"), false);
assert.equal(boundedDamerauLevenshtein("раобта", "работа", 2), 1);
assert.equal(boundedDamerauLevenshtein("превет", "привет", 1), 1);
assert.equal(boundedDamerauLevenshtein("abc", "xyz", 1), null);

const settings: SpellingSettings = {
	enabled: true,
	underline: true,
	languages: ["ru", "en", "de", "ro"],
	sensitivity: "balanced",
	excludedPaths: [],
	personalDictionaryEnabled: true,
};

const loader = new SpellingDictionaryLoader(async (language) => {
	if (language !== "ru") return [];
	return [
		{ word: "работа", frequency: 100, pos: "NOUN" },
		{ word: "работу", frequency: 80, pos: "NOUN" },
		{ word: "привет", frequency: 70, pos: "NOUN" },
	];
});

const engine = new SpellingEngine({
	loader,
	settings: () => settings,
});

async function main(): Promise<void> {
	const typoResult = await engine.checkText("раобта превет", "ru");
	assert.equal(typoResult.checkedWordCount, 2);
	assert.ok(typoResult.issues.length >= 1);
	assert.equal(typoResult.issues[0].word.surfaceForm, "раобта");
	assert.ok(typoResult.issues[0].candidates.some((candidate) => candidate.word === "работа"));

	const correctResult = await engine.checkText("работа привет", "ru");
	assert.equal(correctResult.issues.length, 0);

	let personalContent = "{\"envelopeVersion\":1,\"entries\":[]}";
	let personalDirectoryExists = false;
	const adapter = {
		async exists() { return personalDirectoryExists; },
		async read() { return personalContent; },
		async write(_path: string, content: string) {
			personalContent = content;
		},
		async mkdir() { personalDirectoryExists = true; },
	};
	const personalDictionary = new PersonalSpellingDictionary(adapter, "test-spelling");
	await personalDictionary.add("PolyType", "en");
	assert.equal(personalDictionary.isAllowed("PolyType", "en"), true);
	assert.equal(personalDictionary.isAllowed("polytype", "en"), true);
	await personalDictionary.remove("PolyType", "en");
	assert.equal(personalDictionary.isAllowed("PolyType", "en"), false);

	const cachedEngine = new SpellingEngine({
		loader,
		settings: () => settings,
		personalDictionary,
	});
	assert.equal((await cachedEngine.checkText("раобта", "ru")).issues.length, 1);
	await personalDictionary.add("раобта", "ru");
	assert.equal((await cachedEngine.checkText("раобта", "ru")).issues.length, 0);
	await personalDictionary.remove("раобта", "ru");
	assert.equal((await cachedEngine.checkText("раобта", "ru")).issues.length, 1);

	console.log("Spelling engine, candidate, and personal dictionary tests passed.");
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
