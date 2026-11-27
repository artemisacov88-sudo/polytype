import type { Editor } from "obsidian";

export class SuggestionView {
        private element: HTMLElement | undefined;

        show(
                editor: Editor,
                suggestions: readonly string[] = [],
                onSelect: (suggestion: string) => void,
        ): void {
                this.hide();

                const cursor = editor.getCursor();
                const cmEditor = editor as Editor & {
                        cm: { coordsAtPos(pos: number): DOMRect | null };
                };

                const coords = cmEditor.cm.coordsAtPos(
                        editor.posToOffset(cursor),
                );

                if (!coords) return;

                const popup = document.createElement("div");
                popup.className = "polytype-suggestions";
                popup.setAttribute("role", "listbox");
                popup.style.position = "fixed";
                popup.style.left = `${coords.left}px`;
                popup.style.top = `${coords.bottom}px`;

                for (const suggestion of suggestions) {
                        const item = popup.createDiv({
                                cls: "polytype-suggestion",
                                text: suggestion,
                        });

                        item.setAttribute("role", "option");
                        item.addEventListener("click", () => {
                                onSelect(suggestion);
                        });
                }

                document.body.appendChild(popup);
                this.element = popup;
        }

        hide(): void {
                this.element?.remove();
                this.element = undefined;
        }
}
