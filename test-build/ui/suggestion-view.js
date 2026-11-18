"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuggestionView = void 0;
/** Minimal popup shell positioned beside the active editor cursor. */
class SuggestionView {
    show(editor, suggestions = []) {
        this.hide();
        const cursor = editor.getCursor();
        // Obsidian exposes its CodeMirror view at runtime, though it is not part of the
        // public Editor type. Keep the narrow shape local to avoid another dependency.
        const cmEditor = editor;
        const coords = cmEditor.cm.coordsAtPos(editor.posToOffset(cursor));
        if (!coords)
            return;
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
    hide() {
        this.element?.remove();
        this.element = undefined;
    }
}
exports.SuggestionView = SuggestionView;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3VnZ2VzdGlvbi12aWV3LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3VpL3N1Z2dlc3Rpb24tdmlldy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSxzRUFBc0U7QUFDdEUsTUFBYSxjQUFjO0lBRzFCLElBQUksQ0FBQyxNQUFjLEVBQUUsY0FBaUMsRUFBRTtRQUN2RCxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDWixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDbEMsZ0ZBQWdGO1FBQ2hGLCtFQUErRTtRQUMvRSxNQUFNLFFBQVEsR0FBRyxNQUF1RSxDQUFDO1FBQ3pGLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNuRSxJQUFJLENBQUMsTUFBTTtZQUFFLE9BQU87UUFFcEIsTUFBTSxLQUFLLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUM1QyxLQUFLLENBQUMsU0FBUyxHQUFHLHNCQUFzQixDQUFDO1FBQ3pDLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3RDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQztRQUMvQixLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQztRQUN0QyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQztRQUN2QyxLQUFLLE1BQU0sVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsRUFBRSxHQUFHLEVBQUUscUJBQXFCLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFDL0UsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDckMsQ0FBQztRQUNELFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDO0lBQ3RCLENBQUM7SUFFRCxJQUFJO1FBQ0gsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQztRQUN2QixJQUFJLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQztJQUMxQixDQUFDO0NBQ0Q7QUE5QkQsd0NBOEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBFZGl0b3IgfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuLyoqIE1pbmltYWwgcG9wdXAgc2hlbGwgcG9zaXRpb25lZCBiZXNpZGUgdGhlIGFjdGl2ZSBlZGl0b3IgY3Vyc29yLiAqL1xuZXhwb3J0IGNsYXNzIFN1Z2dlc3Rpb25WaWV3IHtcblx0cHJpdmF0ZSBlbGVtZW50OiBIVE1MRWxlbWVudCB8IHVuZGVmaW5lZDtcblxuXHRzaG93KGVkaXRvcjogRWRpdG9yLCBzdWdnZXN0aW9uczogcmVhZG9ubHkgc3RyaW5nW10gPSBbXSk6IHZvaWQge1xuXHRcdHRoaXMuaGlkZSgpO1xuXHRcdGNvbnN0IGN1cnNvciA9IGVkaXRvci5nZXRDdXJzb3IoKTtcblx0XHQvLyBPYnNpZGlhbiBleHBvc2VzIGl0cyBDb2RlTWlycm9yIHZpZXcgYXQgcnVudGltZSwgdGhvdWdoIGl0IGlzIG5vdCBwYXJ0IG9mIHRoZVxuXHRcdC8vIHB1YmxpYyBFZGl0b3IgdHlwZS4gS2VlcCB0aGUgbmFycm93IHNoYXBlIGxvY2FsIHRvIGF2b2lkIGFub3RoZXIgZGVwZW5kZW5jeS5cblx0XHRjb25zdCBjbUVkaXRvciA9IGVkaXRvciBhcyBFZGl0b3IgJiB7IGNtOiB7IGNvb3Jkc0F0UG9zKHBvczogbnVtYmVyKTogRE9NUmVjdCB8IG51bGwgfSB9O1xuXHRcdGNvbnN0IGNvb3JkcyA9IGNtRWRpdG9yLmNtLmNvb3Jkc0F0UG9zKGVkaXRvci5wb3NUb09mZnNldChjdXJzb3IpKTtcblx0XHRpZiAoIWNvb3JkcykgcmV0dXJuO1xuXG5cdFx0Y29uc3QgcG9wdXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuXHRcdHBvcHVwLmNsYXNzTmFtZSA9IFwicG9seXR5cGUtc3VnZ2VzdGlvbnNcIjtcblx0XHRwb3B1cC5zZXRBdHRyaWJ1dGUoXCJyb2xlXCIsIFwibGlzdGJveFwiKTtcblx0XHRwb3B1cC5zdHlsZS5wb3NpdGlvbiA9IFwiZml4ZWRcIjtcblx0XHRwb3B1cC5zdHlsZS5sZWZ0ID0gYCR7Y29vcmRzLmxlZnR9cHhgO1xuXHRcdHBvcHVwLnN0eWxlLnRvcCA9IGAke2Nvb3Jkcy5ib3R0b219cHhgO1xuXHRcdGZvciAoY29uc3Qgc3VnZ2VzdGlvbiBvZiBzdWdnZXN0aW9ucykge1xuXHRcdFx0Y29uc3QgaXRlbSA9IHBvcHVwLmNyZWF0ZURpdih7IGNsczogXCJwb2x5dHlwZS1zdWdnZXN0aW9uXCIsIHRleHQ6IHN1Z2dlc3Rpb24gfSk7XG5cdFx0XHRpdGVtLnNldEF0dHJpYnV0ZShcInJvbGVcIiwgXCJvcHRpb25cIik7XG5cdFx0fVxuXHRcdGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQocG9wdXApO1xuXHRcdHRoaXMuZWxlbWVudCA9IHBvcHVwO1xuXHR9XG5cblx0aGlkZSgpOiB2b2lkIHtcblx0XHR0aGlzLmVsZW1lbnQ/LnJlbW92ZSgpO1xuXHRcdHRoaXMuZWxlbWVudCA9IHVuZGVmaW5lZDtcblx0fVxufVxuIl19