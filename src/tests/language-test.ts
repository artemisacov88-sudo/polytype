import assert from "node:assert/strict";
import { getLanguageModule } from "../language/registry";

const tests = [
	{ language: "ru", text: "Привет мир Ёлка", expected: ["привет", "мир", "елка"] },
	{ language: "en", text: "Hello world computer", expected: ["hello", "world", "computer"] },
	{ language: "de", text: "Grüße schön Straße", expected: ["grüße", "schön", "straße"] },
	{ language: "ro", text: "Bună ziua țară", expected: ["bună", "ziua", "țară"] },
] as const;

for (const test of tests) {
	const module = getLanguageModule(test.language);
	const words = module.rules.tokenize(test.text);
	assert.deepEqual(
		words.map((word) => module.rules.normalizeWord(word)),
		test.expected,
		`${module.displayName} tokenization and normalization`,
	);
}

assert.deepEqual(getLanguageModule("ru").rules.tokenize("Ёлка").map((word) =>
	getLanguageModule("ru").rules.normalizeWord(word)), ["елка"]);
assert.deepEqual(getLanguageModule("de").rules.tokenize("Grüße").map((word) =>
	getLanguageModule("de").rules.normalizeWord(word)), ["grüße"]);
assert.deepEqual(getLanguageModule("ro").rules.tokenize("Ştiinţă").map((word) =>
	getLanguageModule("ro").rules.normalizeWord(word)), ["știință"]);
assert.deepEqual(getLanguageModule("ro").rules.tokenize("S\u0326tiin\u0163a").map((word) =>
	getLanguageModule("ro").rules.normalizeWord(word)), ["știința"]);

console.log("Language module tests passed (ru, en, de, ro).");
