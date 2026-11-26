import {
        EditorSuggest,
        type EditorSuggestContext,
        type EditorPosition,
        type TFile,
        type CachedMetadata,
} from "obsidian";
import type { App } from "obsidian";
import type { Editor } from "obsidian";
import type { PolyTypeSettings } from "../settings";
import { DictionaryPredictionProvider } from "../prediction/provider";
import type { PredictionDataLoader } from "../prediction/data-source";
import { getLanguageModule } from "../language/registry";
import type { PredictionProvider } from "../prediction/types";
import { buildEditorPredictionSnapshot } from "../prediction/editor-request";
import { presentSuggestion } from "../prediction/presentation";
import { LatestSuggestionRequests } from "./latest-suggestion-requests";
import type { PredictionRouteDiagnostic } from "../prediction/types";

export interface AcceptedSuggestionEvent {
        word: string;
        context: readonly string[];
        language: PolyTypeSettings["language"];
	editor: Editor;
        file: TFile;
        cursorLine: number;
        cursorCh: number;
	wordStartCh: number;
        lineText: string;
	textBeforeCursor: string;
        metadata: CachedMetadata | null;
}

export class PolyTypeSuggest extends EditorSuggest<string> {
        constructor(
                app: App,
                private getSettings: () => PolyTypeSettings,
                loadPredictionAsset: PredictionDataLoader,
                predictionProvider?: PredictionProvider,
                private onSuggestionAccepted?: (event: AcceptedSuggestionEvent) => void,
                private onLanguageResolved?: (language: PolyTypeSettings["language"]) => void,
                private onLanguageDiagnostic?: (detected: PolyTypeSettings["language"] | null, route: PredictionRouteDiagnostic | null) => void,
        ) {
                super(app);
                this.limit = this.getSettings().maxSuggestions;
                this.predictionProvider = predictionProvider ?? new DictionaryPredictionProvider(loadPredictionAsset);
        }

        private predictionProvider: PredictionProvider;
        private readonly latestRequests = new LatestSuggestionRequests<string>();
        private diagnosticGeneration = 0;

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
                const settings = this.getSettings();
                this.limit = settings.maxSuggestions;

                // N-grams need only three previous words. Read a bounded
                // window instead of copying and tokenizing the whole note on
                // every keystroke.
                const cursorOffset = context.editor.posToOffset(context.start);
                const contextStart = context.editor.offsetToPos(Math.max(0, cursorOffset - 512));
                const previousText = context.editor.getRange(contextStart, context.start);

                const snapshot = buildEditorPredictionSnapshot(context.editor, settings, previousText, context.query);
                const generation = ++this.diagnosticGeneration;
                let route: PredictionRouteDiagnostic | null = null;
                const request = {
                        ...snapshot.request,
                        routeDiagnostic: (value: PredictionRouteDiagnostic) => {
                                route = value;
                                if (generation === this.diagnosticGeneration) this.onLanguageDiagnostic?.(snapshot.detectedLanguage, value);
                        },
                };
                this.onLanguageDiagnostic?.(snapshot.detectedLanguage, {
                        requestLanguage: request.language, modelLanguage: null, model: "none", candidateCount: 0,
                });
                if (request.language !== settings.language) this.onLanguageResolved?.(request.language);
                return [...await this.latestRequests.request(async () => {
                        const suggestions = await this.predictionProvider.predict(request);
                        if (generation === this.diagnosticGeneration && !route) {
                                this.onLanguageDiagnostic?.(snapshot.detectedLanguage, {
                                        requestLanguage: request.language, modelLanguage: null,
                                        model: "unknown", candidateCount: suggestions.length,
                                });
                        }
                        return suggestions.map((suggestion) => presentSuggestion(
                                suggestion,
                                previousText,
                                context.query,
                                request.language,
                        ));
                })];
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

                if (this.onSuggestionAccepted) {
                        try {
                                const language = this.getSettings().language;
                                const languageModule = getLanguageModule(language);
                                const cursorOffset = context.editor.posToOffset(context.start);
                                const contextStart = context.editor.offsetToPos(Math.max(0, cursorOffset - 512));
                                const previousText = context.editor.getRange(contextStart, context.start);
                                this.onSuggestionAccepted({
                                        word: value,
                                        context: languageModule.rules.tokenize(previousText)
                                                .map((word) => languageModule.rules.normalizeWord(word)).slice(-3),
                                        language,
                                        editor: context.editor,
                                        file: context.file,
                                        cursorLine: context.end.line,
                                        cursorCh: context.end.ch,
								wordStartCh: context.start.ch,
                                        lineText: context.editor.getLine(context.end.line),
                                        textBeforeCursor: previousText + context.editor.getLine(context.end.line).slice(0, context.end.ch),
                                        metadata: this.app.metadataCache.getFileCache(context.file),
                                });
                        } catch (error) {
                                console.error("[PolyType] Could not record an accepted personal suggestion", error);
                        }
                }

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
