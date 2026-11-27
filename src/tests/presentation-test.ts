import assert from "node:assert/strict";
import { presentSuggestion } from "../prediction/presentation";

for (const language of ["en", "ru", "de", "ro"] as const) {
	const suggestion = language === "en" ? "hello" : language === "ru" ? "привет" : language === "de" ? "guten" : "mulțumesc";
	const expected = language === "en" ? "Hello" : language === "ru" ? "Привет" : language === "de" ? "Guten" : "Mulțumesc";
	assert.equal(presentSuggestion(suggestion, "", "", language), expected,
		`${language} capitalizes at the beginning of a note`);
	for (const punctuation of [".", "!", "?"]) {
		assert.equal(presentSuggestion(suggestion, `Earlier${punctuation} `, "", language), expected,
			`${language} capitalizes after ${punctuation}`);
	}
	assert.equal(presentSuggestion(suggestion, "Earlier\n", "", language), expected,
		`${language} capitalizes after a line break`);
	assert.equal(presentSuggestion(suggestion, "Earlier words ", "", language), suggestion,
		`${language} keeps lowercase in the middle of a sentence`);
	assert.equal(presentSuggestion(suggestion, "Earlier words ", "Mu", language), expected,
		`${language} follows an uppercase typed prefix`);
}

assert.equal(presentSuggestion("mulțumesc", "Guten Morgen! ", "", "ro"), "Mulțumesc");
assert.equal(presentSuggestion("guten", "Bună ziua. ", "", "de"), "Guten");
console.log("Suggestion presentation tests passed (en, ru, de, ro).");
