import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getLanguageModule } from "../language/registry";
import { MultilingualPredictionProvider } from "../prediction/multilingual-provider";
import type { LanguageId } from "../language/types";
import { buildEditorPredictionSnapshot } from "../prediction/editor-request";
import type { CursorReadableEditor, EditorPositionLike } from "../utils/editor-tail";
import type { PredictionRouteDiagnostic } from "../prediction/types";

interface Fixture {
	words: string[];
	context: string;
	target: string;
	bytes: ArrayBuffer;
	manifest: string;
}

async function main(): Promise<void> {
for (const [language, context, target, distractor] of [
	["ru", "я", "говорю", "город"] as const,
	["de", "guten", "morgen", "morgens"] as const,
	["ro", "bună", "ziua", "zid"] as const,
]) {
	const fixture = makeFixture(language, context, target, distractor);
	let binaryReads = 0;
	let dictionaryReads = 0;
	const errors: string[] = [];
	const provider = new MultilingualPredictionProvider(
		{ predict: async () => [] },
		async (path) => {
			if (path.endsWith("words.json")) {
				dictionaryReads++;
				return JSON.stringify(fixture.words.map((word, index) => ({ word, frequency: 100 - index, pos: "X" })));
			}
			return fixture.manifest;
		},
		async (path) => {
			assert.ok(path.endsWith("/binary/model.ptng"));
			binaryReads++;
			return fixture.bytes;
		},
		(message) => errors.push(message),
		(id) => `fixture/${id}`,
	);
	const result = await provider.predictDetailed({ language, context: [context], currentWord: target.slice(0, 1) });
	assert.ok(result.candidatePool.includes(target), `${language} candidate generation includes the contextual target`);
	assert.ok(result.suggestions.includes(target), `${language} ranking returns the contextual target`);
	assert.ok((await provider.predict({ language, context: [context], currentWord: target.slice(0, 1), maxSuggestions: 1 })).length <= 1,
		`${language} provider respects the configured suggestion count`);
	assert.equal(binaryReads, 1, `${language} model is loaded once`);
	assert.equal(dictionaryReads, 0, `${language} healthy binary model does not load the fallback dictionary`);
	assert.deepEqual(errors, []);
}

const fallbackFixture = makeFixture("de", "guten", "morgen", "morgens");
let missingModelReads = 0;
const fallbackNotices: string[] = [];
const fallback = new MultilingualPredictionProvider(
	{ predict: async () => [] },
	async (path) => path.endsWith("words.json")
		? JSON.stringify(fallbackFixture.words.map((word, index) => ({ word, frequency: 100 - index, pos: "X" })))
		: fallbackFixture.manifest,
	async () => { missingModelReads++; throw new Error("ENOENT model.ptng"); },
	(message) => fallbackNotices.push(message),
	(id) => `fallback/${id}`,
);
const fallbackRequest = { language: "de" as const, context: ["guten"], currentWord: "m" };
const firstFallback = await fallback.predict(fallbackRequest);
const secondFallback = await fallback.predict(fallbackRequest);
assert.ok(firstFallback.length > 0 && firstFallback.includes("morgen"));
assert.deepEqual(secondFallback, firstFallback);
assert.equal(missingModelReads, 1, "a failed model is not read on every keystroke");
assert.equal(fallbackNotices.length, 1, "a persistent load error is reported once per session");
assert.equal((await fallback.predict({ ...fallbackRequest, maxSuggestions: 1 })).length, 1,
	"dictionary fallback respects the configured suggestion count");

const mismatchedFixture = makeFixture("de", "guten", "morgen", "morgens");
const mismatchedNotices: string[] = [];
const mismatched = new MultilingualPredictionProvider(
	{ predict: async () => [] },
	async (path) => path.endsWith("words.json")
		? JSON.stringify(mismatchedFixture.words.map((word, index) => ({ word, frequency: 100 - index, pos: "X" })))
		: JSON.stringify({ ...JSON.parse(mismatchedFixture.manifest), language: "ru" }),
	async () => mismatchedFixture.bytes,
	(message) => mismatchedNotices.push(message),
	(id) => `mismatch/${id}`,
);
const rejectedWrongLanguage = await mismatched.predict({ language: "de", context: ["guten"], currentWord: "m" });
assert.ok(rejectedWrongLanguage.length > 0, "wrong-language model uses the local dictionary fallback");
assert.equal(mismatchedNotices.length, 1);
assert.match(mismatchedNotices[0], /Expected de model, received ru/);

const switchingFixtures = new Map<LanguageId, Fixture>([
	["ru", makeFixture("ru", "я", "говорю", "город")],
	["de", makeFixture("de", "guten", "morgen", "morgens")],
	["ro", makeFixture("ro", "bună", "ziua", "zid")],
]);
const modelReads = new Map<LanguageId, number>();
const switching = new MultilingualPredictionProvider(
	{ predict: async () => [] },
	async (path) => {
		const language = path.includes("/ru/") ? "ru" : path.includes("/ro/") ? "ro" : "de";
		return switchingFixtures.get(language)!.manifest;
	},
	async (path) => {
		const language = path.includes("/ru/") ? "ru" : path.includes("/ro/") ? "ro" : "de";
		modelReads.set(language, (modelReads.get(language) ?? 0) + 1);
		return switchingFixtures.get(language)!.bytes;
	},
	() => undefined,
	(id) => `switching/${id}`,
);
await switching.predict({ language: "ru", context: ["я"], currentWord: "г" });
await switching.predict({ language: "de", context: ["guten"], currentWord: "m" });
await switching.predict({ language: "ru", context: ["я"], currentWord: "г" });
assert.equal(modelReads.get("ru"), 2, "only the active non-English model stays resident across language switches");

// Use the EditorSuggest cursor snapshot builder and pass its exact request
// through a Provider spy into the real multilingual model selector.
async function routeWords(opening: string, words: readonly string[], startingLanguage: LanguageId, expected: LanguageId): Promise<void> {
	let currentLanguage = startingLanguage;
	let typed = "";
	let firstResolved = false;
	for (const word of words) {
		typed += `${word} `;
		const note = `${opening}\n${typed.trimEnd()}`;
		const editor = cursorEditor(note);
		const start = note.length - word.length;
		const previousText = editor.getRange(editor.offsetToPos(Math.max(0, start - 512)), editor.offsetToPos(start));
		const snapshot = buildEditorPredictionSnapshot(editor, {
			language: currentLanguage, languageMode: "auto", maxSuggestions: 5,
		}, previousText, word);
		let route: PredictionRouteDiagnostic | undefined;
		const request = { ...snapshot.request, routeDiagnostic: (value: PredictionRouteDiagnostic) => { route = value; } };
		let providerArgument: LanguageId | undefined;
		const actualProvider = {
			predict: async (passed: typeof request) => {
				providerArgument = passed.language;
				return switching.predict(passed);
			},
		};
		await actualProvider.predict(request);
		assert.equal(providerArgument, snapshot.request.language, `${expected}: Provider receives exact editor request language`);
		if (snapshot.detectedLanguage) currentLanguage = snapshot.detectedLanguage;
		if (snapshot.detectedLanguage === expected) firstResolved = true;
		if (firstResolved) {
			assert.equal(providerArgument, expected, `${expected}: detected language is passed to Provider at word ${word}`);
			assert.equal(route?.requestLanguage, expected, `${expected}: diagnostic records actual request language`);
			assert.equal(route?.modelLanguage, expected, `${expected}: selected model language matches request`);
			assert.equal(route?.model, "ngram", `${expected}: binary model produced candidates`);
			assert.ok(Number.isInteger(route?.candidateCount) && (route?.candidateCount ?? -1) >= 0,
				`${expected}: candidate count is reported for word ${word}`);
		}
	}
	assert.ok(firstResolved, `gradual editor input resolves and routes to ${expected}`);
}

await routeWords("Guten Morgen, ich spreche Deutsch.", ["Bună", "ziua", "mulțumesc", "pentru", "ajutor"], "de", "ro");
await routeWords("Bună ziua, mulțumesc pentru ajutor.", ["Guten", "Morgen", "ich", "spreche", "Deutsch"], "ro", "de");
console.log("Multilingual provider tests passed (ru, de, ro, fallback).");
}

function cursorEditor(text: string): CursorReadableEditor {
	const offsetAt = (position: EditorPositionLike) => text.split("\n").slice(0, position.line)
		.reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
	const positionAt = (offset: number): EditorPositionLike => {
		const lines = text.slice(0, offset).split("\n");
		return { line: lines.length - 1, ch: lines[lines.length - 1].length };
	};
	return {
		getCursor: () => positionAt(text.length),
		posToOffset: offsetAt,
		offsetToPos: positionAt,
		getRange: (from, to) => text.slice(offsetAt(from), offsetAt(to)),
	};
}

function makeFixture(language: LanguageId, rawContext: string, rawTarget: string, rawDistractor: string): Fixture {
	const normalize = getLanguageModule(language).rules.normalizeWord;
	const context = normalize(rawContext);
	const target = normalize(rawTarget);
	const distractor = normalize(rawDistractor);
	const words = [...new Set([context, target, distractor])].sort();
	const ids = new Map(words.map((word, index) => [word, index]));
	const records: number[][][] = [
		words.map((word, index) => [1, ids.get(word)!, 100 - index]),
		[[2, ids.get(context)!, ids.get(target)!, 8]],
		[],
		[],
	];
	const chunks: Uint8Array[] = [];
	const header = Buffer.alloc(44);
	header.write("PTNG", 0, "ascii");
	header.writeUInt32LE(1, 4);
	header.writeUInt32LE(words.length, 8);
	for (let order = 0; order < 4; order++) header.writeBigUInt64LE(BigInt(records[order].length), 12 + order * 8);
	chunks.push(header);
	for (const word of words) {
		const encoded = Buffer.from(word, "utf8");
		const length = Buffer.alloc(2);
		length.writeUInt16LE(encoded.length);
		chunks.push(length, encoded);
	}
	for (const orderRecords of records) {
		for (const record of orderRecords) {
			const bytes = Buffer.alloc(1 + (record.length - 1) * 4);
			bytes.writeUInt8(record[0], 0);
			for (let index = 1; index < record.length; index++) bytes.writeUInt32LE(record[index], 1 + (index - 1) * 4);
			chunks.push(bytes);
		}
	}
	const binary = Buffer.concat(chunks);
	const bytes = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
	const manifest = JSON.stringify({
		format_version: 1,
		language,
		corpus: "fixture",
		configuration: "test",
		min_count: 1,
		max_successors_per_context: null,
		vocabulary_count: words.length,
		record_counts: Object.fromEntries(records.map((value, index) => [String(index + 1), value.length])),
		binary_bytes: binary.byteLength,
		binary_sha256: createHash("sha256").update(binary).digest("hex"),
	});
	return { words, context, target, bytes, manifest };
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
