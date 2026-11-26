import assert from "node:assert/strict";
import { boundedDamerauLevenshtein } from "../spelling/edit-distance";
import { SpellingDictionaryLoader } from "../spelling/dictionary-provider";
import { SpellingEngine } from "../spelling/spelling-engine";
import type { SpellingSettings } from "../spelling/spelling-types";

const data: Record<"ru" | "en" | "de" | "ro", readonly { word: string; frequency: number; pos: string }[]> = {
	ru: [
		{ word: "работа", frequency: 100, pos: "NOUN" },
		{ word: "работу", frequency: 80, pos: "NOUN" },
		{ word: "привет", frequency: 70, pos: "NOUN" },
		{ word: "интересно", frequency: 50, pos: "ADV" },
	],
	en: [
		{ word: "because", frequency: 100, pos: "CONJ" },
		{ word: "the", frequency: 500, pos: "DET" },
		{ word: "project", frequency: 80, pos: "NOUN" },
	],
	de: [
		{ word: "Straße", frequency: 100, pos: "NOUN" },
		{ word: "Hallo", frequency: 70, pos: "INTJ" },
		{ word: "über", frequency: 60, pos: "PREP" },
	],
	ro: [
		{ word: "bună", frequency: 100, pos: "ADJ" },
		{ word: "țară", frequency: 80, pos: "NOUN" },
		{ word: "și", frequency: 200, pos: "CONJ" },
	],
};

const settings: SpellingSettings = {
	enabled: true,
	underline: true,
	languages: ["ru", "en", "de", "ro"],
	sensitivity: "broad",
	excludedPaths: [],
	personalDictionaryEnabled: false,
};

const loader = new SpellingDictionaryLoader(async (language) => data[language]);
const engine = new SpellingEngine({ loader, settings: () => settings });

async function main(): Promise<void> {
	const samples: readonly [
		"ru" | "en" | "de" | "ro",
		string,
		string,
	][] = [
		["ru", "раобта", "работа"],
		["ru", "превет", "привет"],
		["ru", "интиресно", "интересно"],
		["en", "becouse", "because"],
		["en", "teh", "the"],
		["en", "porject", "project"],
		["de", "Hlla", "Hallo"],
		["ro", "buană", "bună"],
		["ro", "tara", "țară"],
	];

	for (const [language, typed, correction] of samples) {
		const result = await engine.checkText(typed, language);
		assert.equal(result.checkedWordCount, 1);
		if (data[language].some((entry) => entry.word.toLocaleLowerCase() === correction)) {
			assert.equal(result.issues.length, 1, `${language}: ${typed} should be detected`);
			assert.equal(result.issues[0].candidates[0].word, correction,
				`${language}: ${typed} should rank ${correction} first`);
		}
	}

	const mixed = await engine.checkText("Я сегодня работаю над PolyType project", "ru");
	assert.ok(mixed.checkedWordCount >= 5);
	assert.ok(mixed.issues.every((issue) => issue.word.surfaceForm !== "project"));

	const protectedWords = await engine.checkText("NASA XMLtv PolyType", "en");
	assert.equal(protectedWords.issues.length, 0);

	const distances = [
		boundedDamerauLevenshtein("раобта", "работа", 2),
		boundedDamerauLevenshtein("becouse", "because", 2),
		boundedDamerauLevenshtein("Straße", "Strasse", 2),
		boundedDamerauLevenshtein("bună", "buna", 1),
	];
	assert.deepEqual(distances.slice(0, 2), [1, 1]);
	assert.equal(distances[2], 2);
	assert.equal(distances[3], 1);

	const perfStart = performance.now();
	const text = Array.from({ length: 5000 }, (_, index) => index % 20 === 0 ? "раобта" : "слово").join(" ");
	const perfResult = await engine.checkText(text, "ru");
	const elapsed = performance.now() - perfStart;
	assert.ok(perfResult.checkedWordCount === 5000);
	assert.ok(elapsed < 5000, `5000-word check exceeded 5 seconds: ${elapsed.toFixed(1)}ms`);
	console.log(`Spelling audit/performance: 5000 words in ${elapsed.toFixed(1)}ms`);
	console.log("Spelling audit and multilingual regression tests passed.");
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
