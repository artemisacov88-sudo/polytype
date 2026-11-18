import type { Editor } from "obsidian";

/** Minimal popup shell positioned beside the active editor cursor. */
export class SuggestionView {
	private element: HTMLElement | undefined;

	show(editor: Editor, suggestions: readonly string[] = []): void {
		this.hide();
		const cursor = editor.getCursor();
		// Obsidian exposes its CodeMirror view at runtime, though it is not part of the
		// public Editor type. Keep the narrow shape local to avoid another dependency.
		const cmEditor = editor as Editor & { cm: { coordsAtPos(pos: number): DOMRect | null } };
		const coords = cmEditor.cm.coordsAtPos(editor.posToOffset(cursor));
		if (!coords) return;

		const popup = document.createElement("div");
		popup.className = "polytype-suggestions";
		popup.setAttribute("role", "listbox");
		popup.style.position = "fixed";
		popup.style.left = `${coords.left}px`;
		popup.style.top = `${coords.bottom}px`;
		for (const suggestion of suggestions) {
			const item = popup.createDiv({ cls: "polytype-suggestion", text: suggestion });
			item.setAttribute("role", "option");
		}
		document.body.appendChild(popup);
		this.element = popup;
	}

	hide(): void {
		this.element?.remove();
		this.element = undefined;
	}
}
