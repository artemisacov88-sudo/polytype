import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { getStrings } from "./i18n";
import { getSupportedLanguages } from "./language/registry";
import { detectLanguage } from "./language/detector";
import type { LanguageId } from "./language/types";
import { DEFAULT_SETTINGS } from "./settings";
import type { PolyTypeSettings } from "./settings";
import { PolyTypeSuggest } from "./ui/editor-suggest";
import { english } from "./language/modules/english";
import { ExperimentalBinaryPredictionProvider } from "./prediction/experimental-binary-provider";

export default class PolyTypePlugin extends Plugin {
        settings: PolyTypeSettings = { ...DEFAULT_SETTINGS };
        private suggestionStatus!: HTMLElement;

        async onload(): Promise<void> {
                this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };

                this.suggestionStatus = this.addStatusBarItem();
                this.suggestionStatus.setText("PolyType готов");
                const pluginDirectory = this.manifest.dir
                        ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
                this.registerEditorSuggest(
                        new PolyTypeSuggest(
                                this.app,
                                () => this.settings,
                                (asset) => this.app.vault.adapter.read(`${pluginDirectory}/data/${asset}`),
                        )
                );

                const experimentalProvider = new ExperimentalBinaryPredictionProvider(
                        (asset) => this.app.vault.adapter.read(`${pluginDirectory}/data/${asset}`),
                        (path) => this.app.vault.adapter.readBinary(`${pluginDirectory}/${path}`),
                        (path) => this.app.vault.adapter.read(`${pluginDirectory}/${path}`),
                        undefined,
                        undefined,
                        undefined,
                        (path) => this.app.vault.adapter.readBinary(`${pluginDirectory}/${path}`),
                );
                this.addCommand({
                        id: "compare-oanc-binary-predictions",
                        name: "Compare experimental OANC Binary predictions at cursor",
                        editorCallback: async (editor) => {
                                if (this.settings.language !== "en") {
                                        new Notice("Switch PolyType to English to compare the OANC model.");
                                        return;
                                }
                                const cursor = editor.getCursor();
                                const line = editor.getLine(cursor.line).slice(0, cursor.ch);
                                const match = line.match(/[\p{L}]+$/u);
                                if (!match) {
                                        new Notice("Place the cursor after a partial English word to compare predictions.");
                                        return;
                                }
                                const cursorOffset = editor.posToOffset(cursor);
                                const wordStartOffset = cursorOffset - match[0].length;
                                const previousStart = editor.offsetToPos(Math.max(0, wordStartOffset - 512));
                                const wordStart = editor.offsetToPos(wordStartOffset);
                                const previousWords = english.rules.tokenize(editor.getRange(previousStart, wordStart)).slice(-3);
                                const request = {
                                        context: previousWords,
                                        language: "en",
                                        currentWord: match[0],
                                } as const;
                                const [longest, smoothed] = await Promise.all([
                                        experimentalProvider.compare(request, "longest-context"),
                                        experimentalProvider.compare(request, "interpolated-absolute-discount"),
                                ]);
                                const format = (words: readonly string[]) => words.length ? words.join(", ") : "(нет)";
                                const error = smoothed.error ? `\nBinary model unavailable: ${smoothed.error}` : "";
                                new Notice(`Current: ${format(longest.baseline)}\nLongest context: ${format(longest.experimental)}\nIAD: ${format(smoothed.experimental)}${smoothed.algorithm !== "interpolated-absolute-discount" ? " (full context stats unavailable; fallback)" : ""}${error}`, 12000);
                        },
                });

                this.registerEvent(
                        this.app.workspace.on("editor-change", (editor) => {
                                if (this.settings.languageMode === "auto") {
                                        const text = editor.getValue().slice(-500);
                                        const detected = detectLanguage(text);

                                        if (detected && detected !== this.settings.language) {
                                                this.settings.language = detected;
                                                void this.saveSettings();
                                        }
                                }

                        })
                );

                this.addSettingTab(new PolyTypeSettingTab(this.app, this));
        }

        async saveSettings(): Promise<void> {
                await this.saveData(this.settings);
        }
}

class PolyTypeSettingTab extends PluginSettingTab {
        constructor(app: PolyTypePlugin["app"], private readonly plugin: PolyTypePlugin) {
                super(app, plugin);
        }

        display(): void {
                const { containerEl } = this;
                containerEl.empty();
                const strings = getStrings(this.plugin.settings.language);

                containerEl.createEl("h2", { text: strings.settings });

                new Setting(containerEl)
                        .setName("Режим определения языка")
                        .addDropdown((dropdown) => {
                                dropdown
                                        .addOption("auto", "Автоматический")
                                        .addOption("manual", "Ручной")
                                        .setValue(this.plugin.settings.languageMode)
                                        .onChange(async (value) => {
                                                this.plugin.settings.languageMode = value as "auto" | "manual";
                                                await this.plugin.saveSettings();
                                                this.display();
                                        });
                        });

                if (this.plugin.settings.languageMode === "manual") {
                        new Setting(containerEl)
                                .setName(strings.language)
                                .addDropdown((dropdown) => {
                                        for (const language of getSupportedLanguages()) {
                                                dropdown.addOption(language.id, language.displayName);
                                        }
                                        dropdown
                                                .setValue(this.plugin.settings.language)
                                                .onChange(async (value) => {
                                                        this.plugin.settings.language = value as LanguageId;
                                                        await this.plugin.saveSettings();
                                                        this.display();
                                                });
                                });
                }
        }
}
