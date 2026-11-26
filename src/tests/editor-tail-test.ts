import assert from "node:assert/strict";
import { getEditorTextBeforeCursor, type CursorReadableEditor, type EditorPositionLike } from "../utils/editor-tail";

const lines = ["irrelevant ".repeat(100), "Guten Tag! Ich möchte über die Straße sprechen.", "English text after the cursor"];
const text = lines.join("\n");
const toOffset = (position: EditorPositionLike) =>
	lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.ch;
const toPosition = (offset: number): EditorPositionLike => {
	let remaining = offset;
	for (let line = 0; line < lines.length; line++) {
		if (remaining <= lines[line].length) return { line, ch: remaining };
		remaining -= lines[line].length + 1;
	}
	return { line: lines.length - 1, ch: lines.at(-1)!.length };
};
const cursor: EditorPositionLike = { line: 1, ch: lines[1].length };
const editor: CursorReadableEditor = {
	getCursor: () => cursor,
	posToOffset: toOffset,
	offsetToPos: toPosition,
	getRange: (from, to) => text.slice(toOffset(from), toOffset(to)),
};
const beforeCursor = getEditorTextBeforeCursor(editor, 500);
assert.equal(beforeCursor.length, 500);
assert.ok(beforeCursor.endsWith(lines[1]), "context must end at the cursor");
assert.ok(!beforeCursor.includes("English text after the cursor"), "note tail after cursor must be ignored");
assert.equal(getEditorTextBeforeCursor(editor, 0), "");

console.log("Bounded cursor-context tests passed.");
