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

console.log("Language module tests passed (ru, en, de, ro).");
