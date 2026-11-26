import { resolveLanguage } from "../language/detector";
import type { LanguageId } from "../language/types";

export interface EditorPositionLike {
	line: number;
	ch: number;
}

export interface CursorReadableEditor {
	getCursor(): EditorPositionLike;
	posToOffset(position: EditorPositionLike): number;
	offsetToPos(offset: number): EditorPositionLike;
	getRange(from: EditorPositionLike, to: EditorPositionLike): string;
}

/** Read a bounded fragment immediately before the cursor, not the note tail. */
export function getEditorTextBeforeCursor(
	editor: CursorReadableEditor,
	maximumCharacters: number,
): string {
	if (!Number.isFinite(maximumCharacters) || maximumCharacters <= 0) return "";
	const maximum = Math.floor(maximumCharacters);
	const cursor = editor.getCursor();
	const cursorOffset = editor.posToOffset(cursor);
	const start = editor.offsetToPos(Math.max(0, cursorOffset - maximum));
	return editor.getRange(start, cursor).slice(-maximum);
}
/** Resolve from a bounded fragment ending at the live cursor position. */
export function resolveEditorLanguage(
	editor: CursorReadableEditor,
	currentLanguage: LanguageId,
	mode: "auto" | "manual",
	maximumCharacters = 500,
): LanguageId {
	return resolveLanguage(getEditorTextBeforeCursor(editor, maximumCharacters), currentLanguage, mode);
}
