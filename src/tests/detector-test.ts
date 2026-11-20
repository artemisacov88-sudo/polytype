import assert from "node:assert/strict";
import { detectLanguage } from "../language/detector";

const tests = [
	{ text: "Привет, как твои дела?", expected: "ru" },
	{ text: "Hello, how are you?", expected: "en" },
	{ text: "Guten Tag, wie geht es dir?", expected: "de" },
	{ text: "Bună ziua, ce mai faci?", expected: "ro" },
	{ text: "12345", expected: null },
] as const;

for (const test of tests) {
	const result = detectLanguage(test.text);
	assert.equal(result, test.expected, `language detection for ${JSON.stringify(test.text)}`);
}

console.log(`Language detector tests passed (${tests.length} cases).`);
