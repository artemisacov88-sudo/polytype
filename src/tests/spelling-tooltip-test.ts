import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { DEFAULT_SETTINGS } from "../settings";
import { PersonalSpellingDictionary } from "../spelling/personal-dictionary";
import {
	findTooltip,
	replaceSpellingRange,
	spellingDecorationField,
} from "../spelling/obsidian/spelling-extension";
import type { SpellingIssue } from "../spelling/spelling-types";

const issue: SpellingIssue = {
	word: {
		surfaceForm: "превет",
		searchForm: "превет",
		searchAliases: [],
		from: 0,
		to: 6,
		language: "ru",
	},
	candidates: [{ word: "привет", searchForm: "привет", confidence: 0.9 }],
	confidence: 0.9,
};

const state = EditorState.create({
	doc: issue.word.surfaceForm,
	extensions: [spellingDecorationField],
}).update({
	effects: replaceSpellingRange.of({
		from: issue.word.from,
		to: issue.word.to,
		ranges: [{ from: issue.word.from, to: issue.word.to, issue }],
	}),
}).state;

const view = { state, dispatch() {} };
const personalDictionary = new PersonalSpellingDictionary({
	async read() { return "{\"envelopeVersion\":1,\"entries\":[]}"; },
	async write() {},
	async exists() { return false; },
	async mkdir() {},
}, "test-spelling");

const tooltip = findTooltip(view, 2, () => DEFAULT_SETTINGS, personalDictionary);
assert.ok(tooltip);
assert.equal(tooltip.pos, issue.word.from);
assert.equal(tooltip.end, issue.word.to);
assert.equal(findTooltip(view, 8, () => DEFAULT_SETTINGS, personalDictionary), null);

console.log("Spelling tooltip lookup tests passed.");
