import {
        EditorSuggest,
        type EditorSuggestContext,
        type EditorPosition,
        type TFile,
} from "obsidian";
import type { App } from "obsidian";
import type { PolyTypeSettings } from "../settings";
import { DictionaryPredictionProvider } from "../prediction/provider";
import type { PredictionDataLoader } from "../prediction/data-source";
import { getLanguageModule } from "../language/registry";

export class PolyTypeSuggest extends EditorSuggest<string> {
        constructor(
                app: App,
                private getSettings: () => PolyTypeSettings,
                loadPredictionAsset: PredictionDataLoader,
        ) {
                super(app);
                this.limit = 5;
                this.predictionProvider = new DictionaryPredictionProvider(loadPredictionAsset);
        }

        private predictionProvider: DictionaryPredictionProvider;

        onTrigger(
                cursor: EditorPosition,
                editor: EditorSuggestContext["editor"],
                _file: TFile | null,
        ) {
                const line = editor.getLine(cursor.line);
                const beforeCursor = line.slice(0, cursor.ch);
                const match = beforeCursor.match(/[\p{L}]+$/u);

                if (!match) return null;

                return {
                        start: {
                                line: cursor.line,
                                ch: cursor.ch - match[0].length,
                        },
                        end: cursor,
                        query: match[0],
                };
        }

        async getSuggestions(
                context: EditorSuggestContext,
        ): Promise<string[]> {
                const language = this.getSettings().language;
                const languageModule = getLanguageModule(language);

                // N-grams need only three previous words. Read a bounded
                // window instead of copying and tokenizing the whole note on
                // every keystroke.
                const cursorOffset = context.editor.posToOffset(context.start);
                const contextStart = context.editor.offsetToPos(Math.max(0, cursorOffset - 512));
                const previousText = context.editor.getRange(contextStart, context.start);

                const previousWords = languageModule.rules
                        .tokenize(previousText)
                        .slice(-3);

                const suggestions = await this.predictionProvider.predict({
                        context: previousWords,
                        language,
                        currentWord: context.query,
                });

                return [...suggestions];
        }

        renderSuggestion(value: string, element: HTMLElement): void {
                element.createEl("div", { text: value });
        }

        selectSuggestion(
                value: string,
                _event: MouseEvent | KeyboardEvent,
        ): void {
                const context = this.context;
                if (!context) return;

                context.editor.replaceRange(
                        value,
                        context.start,
                        context.end,
                );

                context.editor.setCursor({
                        line: context.end.line,
                        ch: context.start.ch + value.length,
                });

                this.close();
        }
}
