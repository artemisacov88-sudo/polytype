import assert from "node:assert/strict";
import { buildEditorPredictionSnapshot } from "../prediction/editor-request";
import type { CursorReadableEditor, EditorPositionLike } from "../utils/editor-tail";
import type { LanguageId } from "../language/types";
import type { PredictionProvider, PredictionRequest } from "../prediction/types";

interface EditorSuggestStep {
	editor: CursorReadableEditor;
	previousText: string;
	query: string;
}

function editorSuggestStep(note: string): EditorSuggestStep {
	const editor = createEditor(note);
	const match = note.match(/[\p{L}]+$/u);
	assert.ok(match, "the active EditorSuggest query is a trailing word");
	const query = match[0];
	const wordStartOffset = note.length - query.length;
	const contextStart = editor.offsetToPos(Math.max(0, wordStartOffset - 512));
	const wordStart = editor.offsetToPos(wordStartOffset);
	return { editor, previousText: editor.getRange(contextStart, wordStart), query };
}

function createEditor(text: string): CursorReadableEditor {
	const offsetAt = (position: EditorPositionLike) => {
		const lines = text.split("\n");
		return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
	};
	const positionAt = (offset: number): EditorPositionLike => {
		const before = text.slice(0, offset).split("\n");
		return { line: before.length - 1, ch: before[before.length - 1].length };
	};
	return {
		getCursor: () => positionAt(text.length),
		posToOffset: offsetAt,
		offsetToPos: positionAt,
		getRange: (from, to) => text.slice(offsetAt(from), offsetAt(to)),
	};
}

async function walkWords(label: string, opening: string, fragment: readonly string[], initial: LanguageId, expected: LanguageId): Promise<void> {
	let typed = "";
	let currentSetting = initial;
	const seen: Array<{ detected: LanguageId | null; provider: LanguageId }> = [];
	let received: PredictionRequest | undefined;
	const provider: PredictionProvider = {
		predict: async (request) => {
			received = request;
			return [];
		},
	};

	for (const word of fragment) {
		typed += `${word} `;
		const step = editorSuggestStep(`${opening}\n${typed.replace(/\s+$/u, "")}`);
		const snapshot = buildEditorPredictionSnapshot(
			step.editor,
			{ language: currentSetting, languageMode: "auto", maxSuggestions: 5 },
			step.previousText,
			step.query,
		);
		await provider.predict(snapshot.request);
		assert.equal(received?.language, snapshot.request.language, `${label}: Provider receives the built request language`);
		seen.push({ detected: snapshot.detectedLanguage, provider: received!.language });
		// Mirrors the plugin's Auto editor-change handler after each real edit.
		if (snapshot.detectedLanguage) currentSetting = snapshot.detectedLanguage;
	}

	const firstDetected = seen.findIndex(({ detected }) => detected === expected);
	assert.ok(firstDetected >= 0, `${label}: detector resolves ${expected} during gradual input`);
	assert.equal(seen[firstDetected].provider, expected, `${label}: Provider uses ${expected} on the first confident word`);
	for (let index = firstDetected; index < seen.length; index++) {
		assert.equal(seen[index].provider, expected, `${label}: Provider remains ${expected} after word ${index + 1}`);
	}
}

async function main(): Promise<void> {
	await walkWords("DE → RO, diacritic phrase", "Guten Morgen, ich spreche Deutsch.",
		["Bună", "ziua", "mulțumesc", "pentru", "ajutor"], "de", "ro");
	await walkWords("DE → RO, unaccented phrase", "Guten Morgen, ich spreche Deutsch.",
		["eu", "vreau", "sa", "merg", "la", "magazin"], "de", "ro");
	await walkWords("RO → DE", "Bună ziua, eu sunt bine.",
		["Guten", "Morgen", "ich", "spreche", "Deutsch"], "ro", "de");
	console.log("EditorSuggest routing tests passed (gradual DE → RO and RO → DE; codes only).");
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
