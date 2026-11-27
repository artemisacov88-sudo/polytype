import assert from "node:assert/strict";
import {
	canonicalizeApostrophes,
	createSpellingWord,
	normalizeSpellingSurface,
} from "../spelling/normalization";
import { tokenizeSpellingText } from "../spelling/tokenizer";
import {
	getSpellingLanguageProfile,
	getSupportedSpellingLanguageProfiles,
} from "../spelling/language-profiles";
import type {
	SpellingDictionary,
	SpellingLanguageProfile,
	SpellingSettings,
} from "../spelling/spelling-types";

assert.equal(normalizeSpellingSurface("Ёжик", "ru").searchForm, "ежик");
assert.equal(normalizeSpellingSurface("Șase", "ro").searchForm, "șase");
assert.equal(normalizeSpellingSurface("Şase", "ro").searchForm, "șase");
assert.equal(normalizeSpellingSurface("Țară", "ro").searchForm, "țară");
assert.equal(normalizeSpellingSurface("Ţară", "ro").searchForm, "țară");
assert.equal(normalizeSpellingSurface("Straße", "de").searchForm, "straße");
assert.equal(normalizeSpellingSurface("we’ll", "en").searchForm, "we’ll");
assert.equal(canonicalizeApostrophes("don't"), "don’t");

const ruWord = createSpellingWord("Ёжик", 3, 8, "ru");
assert.equal(ruWord.surfaceForm, "Ёжик");
assert.equal(ruWord.searchForm, "ежик");
assert.ok(ruWord.searchAliases.includes("ежик"));
assert.ok(ruWord.searchAliases.includes("ёжик"));
assert.deepEqual(normalizeSpellingSurface("текст", "ru").searchAliases, ["текст"]);

const legacyRomanian = createSpellingWord("Şase", 0, 4, "ro");
assert.equal(legacyRomanian.surfaceForm, "Şase");
assert.equal(legacyRomanian.searchForm, "șase");
assert.ok(legacyRomanian.searchAliases.includes("şase"));

const mixed = tokenizeSpellingText("Я работаю над PolyType project, а nema.");
assert.deepEqual(
	mixed.map(({ surfaceForm, from, to }) => ({ surfaceForm, from, to })),
	[
		{ surfaceForm: "Я", from: 0, to: 1 },
		{ surfaceForm: "работаю", from: 2, to: 9 },
		{ surfaceForm: "над", from: 10, to: 13 },
		{ surfaceForm: "PolyType", from: 14, to: 22 },
		{ surfaceForm: "project", from: 23, to: 30 },
		{ surfaceForm: "а", from: 32, to: 33 },
		{ surfaceForm: "nema", from: 34, to: 38 },
	],
);
assert.equal(mixed[0].language, "ru");
assert.equal(mixed[3].language, "en");
assert.equal(mixed[4].language, "en");

const punctuation = tokenizeSpellingText("Don't — don't. Привет, мир! «șase» 123.");
assert.deepEqual(punctuation.map((word) => word.surfaceForm),
	["Don't", "don't", "Привет", "мир", "șase"]);
assert.equal(punctuation[0].from, 0);
assert.equal(punctuation[0].to, 5);
assert.deepEqual(tokenizeSpellingText("a'b").map((word) => word.surfaceForm), ["a'b"]);
assert.deepEqual(tokenizeSpellingText("a-b").map((word) => word.surfaceForm), ["a-b"]);

const decomposed = "e\u0301";
const decomposedWord = createSpellingWord(decomposed, 0, decomposed.length, "ro");
assert.equal(decomposedWord.surfaceForm, decomposed);
assert.equal(decomposedWord.searchForm.normalize("NFC"), "é".normalize("NFC"));
assert.equal(decomposedWord.to, decomposedWord.from + decomposed.length);

const profile: SpellingLanguageProfile = {
	language: "en",
	normalizeForSearch: (word) => normalizeSpellingSurface(word, "en").searchForm,
	searchAliases: (word) => normalizeSpellingSurface(word, "en").searchAliases,
	editDistance: {
		language: "en",
		lengthThresholds: [],
		insertionWeight: 1,
		deletionWeight: 1,
		substitutionWeight: 1,
		transpositionWeight: 1,
		repeatedLetterPenalty: 0,
		confidenceFloor: 0,
	},
	ignoreCapitalizedWords: true,
	ignoreAbbreviations: true,
	ignoreTechnicalTokens: true,
};
assert.equal(profile.normalizeForSearch("WE’LL"), "we’ll");

const dictionary: SpellingDictionary = {
	language: "en",
	entries: [],
	has: () => false,
	get: () => undefined,
};
assert.equal(dictionary.has("hello"), false);

const settings: SpellingSettings = {
	enabled: true,
	underline: true,
	languages: ["ru", "en", "de", "ro"],
	sensitivity: "highPrecision",
	excludedPaths: [],
	personalDictionaryEnabled: false,
};
assert.deepEqual(settings.languages, ["ru", "en", "de", "ro"]);

assert.deepEqual(
	getSupportedSpellingLanguageProfiles().map((profile) => profile.language),
	["ru", "en", "de", "ro"],
);
assert.equal(getSpellingLanguageProfile("ru").normalizeForSearch("Ёжик"), "ежик");
assert.equal(getSpellingLanguageProfile("de").normalizeForSearch("STRAẞE"), "straße");
assert.equal(getSpellingLanguageProfile("ro").normalizeForSearch("Șase"), "șase");

console.log("Spelling core contracts, normalization, and tokenizer tests passed.");
