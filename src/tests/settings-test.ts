import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings } from "../settings";

assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS, "missing settings use defaults");
assert.deepEqual(normalizeSettings({
	language: "de",
	languageMode: "auto",
	maxSuggestions: 3,
	spellingCheckEnabled: true,
	spellingUnderlineEnabled: true,
	spellingLanguages: ["ru", "en", "de", "ro"],
	spellingSensitivity: "highPrecision",
	personalLearningEnabled: true,
	personalExcludedPaths: [" Private ", "Private", 42, "", "Templates"],
	experimentalOancEnabled: "enabled",
}), {
	language: "de",
	languageMode: "auto",
	maxSuggestions: 3,
	spellingCheckEnabled: true,
	spellingUnderlineEnabled: true,
	spellingLanguages: ["ru", "en", "de", "ro"],
	spellingSensitivity: "highPrecision",
	personalLearningEnabled: true,
	personalExcludedPaths: ["Private", "Templates"],
	experimentalOancEnabled: false,
}, "valid persisted fields survive normalization and exclusions are cleaned");
assert.equal(normalizeSettings({ experimentalOancEnabled: true }).experimentalOancEnabled, true,
	"the experimental model requires a valid explicit opt-in");
assert.equal(normalizeSettings({ maxSuggestions: 1 }).maxSuggestions, 1);
assert.equal(normalizeSettings({ maxSuggestions: 10 }).maxSuggestions, 10);
assert.equal(normalizeSettings({ maxSuggestions: 2.5 }).maxSuggestions, 5,
	"fractional suggestion counts fall back to the legacy default");
assert.deepEqual(normalizeSettings({
	language: "xx",
	languageMode: "automatic",
	maxSuggestions: 0,
	personalLearningEnabled: "yes",
	personalExcludedPaths: "Private",
}), DEFAULT_SETTINGS, "unknown and malformed settings safely fall back to defaults");
assert.deepEqual(normalizeSettings({ language: "en", languageMode: "manual" }), {
	...DEFAULT_SETTINGS,
	language: "en",
	languageMode: "manual",
}, "legacy settings migrate by defaulting newly added preferences");

console.log("Settings normalization tests passed.");
