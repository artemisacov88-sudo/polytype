import { getLanguageModule } from "../language/registry";
import { detectLanguage } from "../language/detector";
import type { LanguageId } from "../language/types";
import type { LanguageMode } from "../settings";
import { getEditorTextBeforeCursor, type CursorReadableEditor } from "../utils/editor-tail";
import type { PredictionRequest } from "./types";

export interface EditorPredictionSettings {
	language: LanguageId;
	languageMode: LanguageMode;
	maxSuggestions: number;
}

export interface EditorPredictionSnapshot {
	detectedLanguage: LanguageId | null;
	request: PredictionRequest;
}

/** Build the exact request sent to a provider from the live editor cursor. */
export function buildEditorPredictionRequest(
	editor: CursorReadableEditor,
	settings: EditorPredictionSettings,
	previousText: string,
	query: string,
): PredictionRequest {
	return buildEditorPredictionSnapshot(editor, settings, previousText, query).request;
}

/** Resolve diagnostics and the Provider request from the same live editor cursor. */
export function buildEditorPredictionSnapshot(
	editor: CursorReadableEditor,
	settings: EditorPredictionSettings,
	previousText: string,
	query: string,
): EditorPredictionSnapshot {
	const detectedLanguage = detectLanguage(getEditorTextBeforeCursor(editor, 500));
	const language = settings.languageMode === "manual"
		? settings.language
		: detectedLanguage ?? settings.language;
	const rules = getLanguageModule(language).rules;
	return {
		detectedLanguage,
		request: {
			context: rules.tokenize(previousText).map(rules.normalizeWord).slice(-3),
			language,
			currentWord: rules.normalizeWord(query),
			maxSuggestions: settings.maxSuggestions,
		},
	};
}
