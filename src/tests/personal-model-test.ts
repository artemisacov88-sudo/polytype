import assert from "node:assert/strict";
import { PERSONAL_MODEL_LIMITS, PersonalModel } from "../personal-learning/personal-model";

const model = new PersonalModel();

assert.equal(model.registerAcceptedSuggestion("Tea", [], "en", "journal/today.md"), true);
const first = model.getStatistics();
assert.equal(first.acceptedSuggestions, 1);
assert.equal(first.unigrams.get("tea"), 1);
assert.deepEqual(first.bigrams, []);
assert.deepEqual(first.trigrams, []);

assert.equal(model.registerAcceptedSuggestion("tea", [], "en", "journal/today.md"), true);
assert.equal(model.getStatistics().unigrams.get("tea"), 2, "repeated accepted choices increment frequency");
assert.equal(model.getStatistics().acceptedSuggestions, 2);

assert.equal(model.registerAcceptedSuggestion("coffee", ["prefer"], "en", "journal/today.md"), true);
assert.deepEqual(model.getStatistics().bigrams, [
	{ context: ["prefer"], word: "coffee", count: 1 },
]);

assert.equal(model.registerAcceptedSuggestion("milk", ["i", "like"], "en", "journal/today.md"), true);
assert.deepEqual(model.getStatistics().trigrams, [
	{ context: ["i", "like"], word: "milk", count: 1 },
]);
assert.equal(model.registerTypedWord("because", ["i", "think"], "en", "journal/today.md"), true);
assert.equal(model.getStatistics().acceptedSuggestions, 4, "typed words are not counted as accepted suggestions");
assert.equal(model.getStatistics().typedWords, 1);

assert.equal(model.registerAcceptedSuggestion("coffee", ["prefer"], "en", "recipes.md"), true);
assert.equal(model.getStatistics().unigrams.get("coffee"), 2);
assert.deepEqual(model.getNoteStatistics("recipes.md")?.bigrams, [
	{ context: ["prefer"], word: "coffee", count: 1 },
]);
assert.equal(model.getNoteStatistics("missing.md"), undefined);
const pathModel = new PersonalModel();
assert.equal(pathModel.registerAcceptedSuggestion("word", [], "en", " journal.md"), true);
assert.notEqual(pathModel.getNoteStatistics(" journal.md"), pathModel.getNoteStatistics("journal.md"),
	"note paths are preserved exactly after validation");

assert.equal(model.excludeNote("journal/today.md"), true);
const remaining = model.getStatistics();
assert.equal(remaining.acceptedSuggestions, 1);
assert.equal(remaining.typedWords, 0);
assert.deepEqual([...remaining.unigrams.entries()], [["coffee", 1]]);
assert.deepEqual(remaining.bigrams, [{ context: ["prefer"], word: "coffee", count: 1 }]);
assert.equal(model.getUsage().bigramTypes, 1, "a context edge shared with another note remains indexed after exclusion");
assert.deepEqual(remaining.trigrams, []);
assert.equal(model.excludeNote("journal/today.md"), false, "excluding a note twice is harmless");
assert.equal(model.getStatistics().acceptedSuggestions, 1);

// Returned snapshots are isolated from the live model.
(remaining.unigrams as Map<string, number>).set("coffee", -100);
assert.equal(model.getStatistics().unigrams.get("coffee"), 1);

const beforeInvalidInputs = model.getStatistics();
const invalidRegistrations: Array<[string, readonly string[], string, string]> = [
	["", [], "en", "notes.md"],
	["!!!", [], "en", "notes.md"],
	["two words", [], "en", "notes.md"],
	["word", ["valid", "!!!"], "en", "notes.md"],
	["word", ["valid word"], "en", "notes.md"],
	["word", ["one", "two", "three", "four"], "en", "notes.md"],
	["word", [], "ru", "notes.md"],
	["word", [], "en", "   "],
];
for (const [word, context, language, path] of invalidRegistrations) {
	assert.equal(model.registerAcceptedSuggestion(word, context, language, path), false);
}
assert.equal(model.registerAcceptedSuggestion("word", ["valid", 3] as unknown as string[], "en", "notes.md"), false,
	"non-string context entries are rejected");
assert.equal(model.registerAcceptedSuggestion("word", null as unknown as string[], "en", "notes.md"), false,
	"non-array context is rejected");
assert.deepEqual(model.getStatistics(), beforeInvalidInputs, "invalid input must not mutate aggregate state");
assert.equal(model.getNoteStatistics("notes.md"), undefined, "invalid input must not create a note bucket");

const restored = PersonalModel.fromJSON(model.toJSON());
assert.deepEqual(restored.getStatistics(), model.getStatistics(), "serialized note statistics restore the aggregate model");
assert.deepEqual(restored.getNotePaths(), model.getNotePaths());
assert.throws(() => PersonalModel.fromJSON({ version: 99, language: "en", notes: [] }),
	"unknown model versions are rejected");

const bounded = new PersonalModel();
for (let index = 0; index < PERSONAL_MODEL_LIMITS.maxWordTypes; index++) {
	let value = index;
	let word = "";
	do {
		word = String.fromCharCode(97 + value % 26) + word;
		value = Math.floor(value / 26);
	} while (value > 0);
	assert.equal(bounded.registerAcceptedSuggestion(`w${word}`, [], "en", "limits.md"), true);
}
assert.equal(bounded.registerAcceptedSuggestion("beyondlimit", [], "en", "limits.md"), false,
	"model refuses new word types after the configured storage bound");
assert.equal(bounded.getUsage().wordTypes, PERSONAL_MODEL_LIMITS.maxWordTypes);

console.log("Personal model tests passed.");
