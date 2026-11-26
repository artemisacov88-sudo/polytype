import assert from "node:assert/strict";
import { detectLanguage, resolveLanguage } from "../language/detector";
import { getEditorTextBeforeCursor, resolveEditorLanguage, type CursorReadableEditor } from "../utils/editor-tail";
import { buildEditorPredictionRequest } from "../prediction/editor-request";
import type { LanguageId } from "../language/types";
import type { PredictionProvider, PredictionRequest } from "../prediction/types";

const tests = [
	{ text: "Привет! Как поживаешь? Сегодня мы обсуждаем новый план.", expected: "ru" },
	{ text: "Hello, how are you? I would like to discuss the new plan with you.", expected: "en" },
	{ text: "Guten Morgen", expected: "de" },
	{ text: "Ich spreche Deutsch", expected: "de" },
	{ text: "Grüße aus Berlin", expected: "de" },
	{ text: "Bună ziua", expected: "ro" },
	{ text: "Sunt bine", expected: "ro" },
	{ text: "Mulțumesc pentru ajutor", expected: "ro" },
	{ text: "Guten Tag! Ich möchte über die Straße und Grüße sprechen.", expected: "de" },
	{ text: "Bună ziua! Și eu vorbesc despre țară și întâlnirea de mâine.", expected: "ro" },
	{ text: "gr", expected: null },
	{ text: "mul", expected: null },
	{ text: "the", expected: null },
	{ text: "abc", expected: null },
] as const;

for (const [index, test] of tests.entries()) {
	const result = detectLanguage(test.text);
	assert.equal(result, test.expected, `language detection case ${index + 1}`);
}

assert.equal(resolveLanguage("mul", "de", "auto"), "de",
	"an ambiguous short prefix must preserve the current language");
assert.equal(resolveLanguage("the", "ru", "auto"), "ru",
	"a single marker is insufficient to switch languages");
assert.equal(resolveLanguage("Bună ziua! Și eu vorbesc despre țară.", "en", "manual"), "en",
	"manual mode must preserve the user's selected language");
assert.equal(resolveLanguage("Guten Tag! Ich möchte über die Straße sprechen.", "en", "auto"), "de");

for (const [noteText, cursorAt, current, expected] of [
	["Привет, сегодня хорошая погода. Guten Tag! Ich möchte über die Straße sprechen.", 0, "ru", "de"],
	["Привет, сегодня хорошая погода. Bună ziua! Și eu vorbesc despre țară.", 0, "ru", "ro"],
	["Guten Morgen! Ich spreche Deutsch. Сегодня хорошая погода, я дома.", 0, "de", "ru"],
	["Mulțumesc pentru ajutor. Sunt bine. Сегодня хорошая погода, я дома.", 0, "ro", "ru"],
	["The meeting is tomorrow. Guten Tag! Ich möchte über die Straße sprechen.", 0, "en", "de"],
	["The meeting is tomorrow. Bună ziua! Și eu vorbesc despre țară.", 0, "en", "ro"],
] as const) {
	const editor = editorFor(noteText, cursorAt);
	assert.equal(resolveEditorLanguage(editor, current, "auto"), expected,
		`cursor language should be ${expected} regardless of earlier note language`);
}
assert.equal(resolveEditorLanguage(editorFor("Привет, Guten Morgen", 0), "ru", "auto"), "ru",
	"short ambiguous text keeps the current language");
assert.equal(resolveEditorLanguage(editorFor("Сегодня хорошая погода, я дома.", 0), "de", "manual"), "de",
	"manual mode keeps the selected language");

const germanAtCursor = "Guten Tag! Ich möchte über die Straße sprechen.";
const englishNoteEnding = " The meeting is tomorrow, and I would like to discuss it with you.";
const note = `${germanAtCursor}\n\n${englishNoteEnding}`;
const editor: CursorReadableEditor = {
	getCursor: () => ({ line: 0, ch: germanAtCursor.length }),
	posToOffset: (position) => position.ch,
	offsetToPos: (offset) => ({ line: 0, ch: offset }),
	getRange: (from, to) => note.slice(from.ch, to.ch),
};
const context = getEditorTextBeforeCursor(editor, 500);
assert.equal(context, germanAtCursor);
assert.equal(detectLanguage(context), "de",
	"the English note ending after the cursor must not affect the nearby German context");
assert.equal(getEditorTextBeforeCursor(editor, 8), germanAtCursor.slice(-8),
	"cursor context must remain bounded");

// Exercise the production request builder and the provider boundary: language
// comes from text at the cursor even when older Cyrillic text is in the note.
const mixedEditor = editorFor("Русский абзац выше. Bună ziua! Și eu vorb", 0);
let received: PredictionRequest | undefined;
const captureProvider: PredictionProvider = {
	predict: async (request) => { received = request; return []; },
};
const providerRequest = buildEditorPredictionRequest(
	mixedEditor,
	{ language: "ru", languageMode: "auto", maxSuggestions: 5 },
	"Bună ziua! Și eu ",
	"vorb",
);
void captureProvider.predict(providerRequest).then(() => {
	assert.equal(received?.language, "ro", "the next provider request receives the language detected at the cursor");
}).catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});

function editorFor(text: string, cursorOffsetFromEnd: number): CursorReadableEditor {
	const offset = text.length - cursorOffsetFromEnd;
	const positionAt = (value: number) => {
		const before = text.slice(0, value).split("\n");
		return { line: before.length - 1, ch: before[before.length - 1].length };
	};
	const offsetAt = (position: { line: number; ch: number }) => {
		const lines = text.split("\n");
		return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
	};
	return {
		getCursor: () => positionAt(offset),
		posToOffset: offsetAt,
		offsetToPos: positionAt,
		getRange: (from, to) => text.slice(offsetAt(from), offsetAt(to)),
	};
}

const romanianAtCursor = "Mulțumesc pentru ajutor. Sunt bine.";
const mixedRomanianNote = `${romanianAtCursor}\n\n${englishNoteEnding}`;
const romanianEditor: CursorReadableEditor = {
	getCursor: () => ({ line: 0, ch: romanianAtCursor.length }),
	posToOffset: (position) => position.ch,
	offsetToPos: (offset) => ({ line: 0, ch: offset }),
	getRange: (from, to) => mixedRomanianNote.slice(from.ch, to.ch),
};
assert.equal(detectLanguage(getEditorTextBeforeCursor(romanianEditor, 500)), "ro",
	"Romanian at the cursor must win over English text after it");

// Walk each word exactly as EditorSuggest does while the cursor advances.
// Assertions mention only the word index/language and never print note text.
for (const [opening, words, expected, switchWordIndex] of [
	["Guten Morgen, ich spreche Deutsch ", "Mulțumesc pentru ajutor și sunt bine".split(" "), "ro", 0],
	["Bună ziua, eu sunt bine ", "Ich spreche Deutsch und guten Morgen".split(" "), "de", 2],
] as const) {
	let typed = opening;
	let firstDetection = -1;
	let detectionAfterEachWord: Array<string | null> = [];
	let currentLanguage: LanguageId = expected === "ro" ? "de" : "ro";
	for (const [index, word] of words.entries()) {
		typed += `${word} `;
		currentLanguage = resolveLanguage(typed, currentLanguage, "auto");
		const detection = currentLanguage;
		detectionAfterEachWord.push(detection);
		if (detection === expected && firstDetection < 0) firstDetection = index;
	}
	assert.equal(firstDetection, switchWordIndex, `${expected} should switch on the first confident new word`);
	for (let index = firstDetection; index < detectionAfterEachWord.length; index++) {
		assert.equal(detectionAfterEachWord[index], expected, `${expected} remains selected after word ${index + 1}`);
	}
}

for (const [opening, words] of [
	["Guten Morgen, ich spreche Deutsch ", "Vreau să mergem la magazin astăzi".split(" ")],
	["Guten Morgen, ich spreche Deutsch ", "eu merg acum la casa mare".split(" ")],
] as const) {
	let typed = opening;
	for (const word of words) {
		typed += `${word} `;
		const detected = detectLanguage(typed);
		if (detected === "ro") break;
	}
	assert.equal(detectLanguage(typed), "ro", "Romanian phrase resolves from local unaccented/diacritic context");
}

const liveText = "Guten Morgen, ich spreche Deutsch Mulțumesc pentru ajutor ";
const liveEditor = editorFor(liveText, 0);
const liveRequest = buildEditorPredictionRequest(liveEditor,
	{ language: "de", languageMode: "auto", maxSuggestions: 5 },
	"Guten Morgen, ich spreche Deutsch Mulțumesc pentru ", "ajutor");
assert.equal(liveRequest.language, "ro", "the production request builder routes Romanian to Provider immediately");
void captureProvider.predict(liveRequest).then(() => {
	assert.equal(received?.language, "ro", "Provider receives the detected language on that same word");
}).catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
const germanCapture: PredictionProvider = {
	predict: async (request) => {
		assert.equal(request.language, "de", "reverse request reaches Provider in German immediately after detection");
		return [];
	},
};
const reverseRequest = buildEditorPredictionRequest(
	editorFor("Bună ziua, eu sunt bine. Ich spreche Deutsch", 0),
	{ language: "ro", languageMode: "auto", maxSuggestions: 5 },
	"Bună ziua, eu sunt bine. Ich spreche ",
	"Deutsch",
);
assert.equal(reverseRequest.language, "de", "production request builder resolves RO → DE at the confident word");
void germanCapture.predict(reverseRequest).catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
assert.equal(buildEditorPredictionRequest(liveEditor,
	{ language: "de", languageMode: "manual", maxSuggestions: 5 },
	"Mulțumesc pentru ", "ajutor").language, "de", "manual mode keeps the selected provider language");

console.log(`Language detector tests passed (${tests.length} language/ambiguity cases plus cursor and mode checks).`);
