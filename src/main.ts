import { Modal, Notice, Plugin, PluginSettingTab, Setting, type Editor } from "obsidian";
import { getStrings } from "./i18n";
import { getSupportedLanguages } from "./language/registry";
import type { LanguageId } from "./language/types";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";
import type { PolyTypeSettings } from "./settings";
import { PolyTypeSuggest } from "./ui/editor-suggest";
import { english } from "./language/modules/english";
import { ExperimentalBinaryPredictionProvider } from "./prediction/experimental-binary-provider";
import { DictionaryPredictionProvider, OptInPredictionProvider } from "./prediction/provider";
import { MultilingualPredictionProvider } from "./prediction/multilingual-provider";
import { PersonalizedPredictionProvider } from "./personal-learning/personalized-provider";
import { PersonalLearningService } from "./personal-learning/learning-service";
import { PersonalModelStorage, PERSONAL_MODEL_DIRECTORY } from "./personal-learning/storage";
import { isEligibleLearningLocation } from "./personal-learning/eligibility";
import { classifyAcceptedMarker, detectCompletedTypedWord, type AcceptedSuggestionMarker } from "./personal-learning/typed-word-observer";
import type { PersonalModelAdapter } from "./personal-learning/storage";
import { getEditorTextBeforeCursor } from "./utils/editor-tail";
import { detectLanguage } from "./language/detector";
import type { PredictionRouteDiagnostic } from "./prediction/types";
import { getLanguageModule } from "./language/registry";
import { SpellingDictionaryLoader, createBundledSpellingDictionaryReader } from "./spelling/dictionary-provider";
import { SpellingEngine } from "./spelling/spelling-engine";
import { PersonalSpellingDictionary } from "./spelling/personal-dictionary";
import { createSpellingExtension } from "./spelling/obsidian/spelling-extension";
import { NGramContextCandidateRanker } from "./spelling/context-ranker";

export default class PolyTypePlugin extends Plugin {
        settings: PolyTypeSettings = { ...DEFAULT_SETTINGS };
        private suggestionStatus!: HTMLElement;
        private personalLearning!: PersonalLearningService;
        private previousEditorLine = new WeakMap<Editor, { line: number; text: string }>();
        private acceptedSuggestionMarker = new WeakMap<Editor, AcceptedSuggestionMarker>();
        private personalSpellingDictionary!: PersonalSpellingDictionary;

        async onload(): Promise<void> {
                const storedSettings = await this.loadData() as Partial<PolyTypeSettings> | null;
		this.settings = normalizeSettings(storedSettings);

                this.suggestionStatus = this.addStatusBarItem();
                this.renderLanguageDiagnostic();
                const pluginDirectory = this.manifest.dir
                        ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
                const loadPredictionAsset = (asset: "english-words.json" | "english-collocations.json") =>
                        this.app.vault.adapter.read(`${pluginDirectory}/data/${asset}`);
                const experimentalProvider = new ExperimentalBinaryPredictionProvider(
                        loadPredictionAsset,
                        (path) => this.app.vault.adapter.readBinary(`${pluginDirectory}/${path}`),
                        (path) => this.app.vault.adapter.read(`${pluginDirectory}/${path}`),
                        (message) => new Notice(`Experimental OANC model unavailable: ${message}`, 8000),
                        undefined,
                        undefined,
                        (path) => this.app.vault.adapter.readBinary(`${pluginDirectory}/${path}`),
                );
                this.personalLearning = new PersonalLearningService(
                        new PersonalModelStorage(
                                this.app.vault.adapter as unknown as PersonalModelAdapter,
                                `${this.app.vault.configDir}/plugins/${this.manifest.id}-${PERSONAL_MODEL_DIRECTORY}`,
                        ),
                        (message) => new Notice(message, 8000),
                );
                const dictionaryProvider = new DictionaryPredictionProvider(loadPredictionAsset);
                const multilingualProvider = new MultilingualPredictionProvider(
                        dictionaryProvider,
                        (path) => this.app.vault.adapter.read(`${pluginDirectory}/${path}`),
                        (path) => this.app.vault.adapter.readBinary(`${pluginDirectory}/${path}`),
                        (message) => new Notice(message, 8000),
                );
                const baseProvider = new OptInPredictionProvider(
                        multilingualProvider,
                        experimentalProvider,
                        () => this.settings.experimentalOancEnabled,
                );
                const predictionProvider = new PersonalizedPredictionProvider(
                        baseProvider,
                        () => this.personalLearning.isReady ? this.personalLearning.model : undefined,
                        () => this.settings.personalLearningEnabled && this.personalLearning.isEnabled,
                );
                const spellingReader = createBundledSpellingDictionaryReader(
                        (path) => this.app.vault.adapter.read(path),
                        pluginDirectory,
                );
                const spellingLoader = new SpellingDictionaryLoader(spellingReader);
                this.personalSpellingDictionary = new PersonalSpellingDictionary({
                        exists: (path) => this.app.vault.adapter.exists(path),
                        read: (path) => this.app.vault.adapter.read(path),
                        write: (path, content) => this.app.vault.adapter.write(path, content),
                        mkdir: (path) => this.app.vault.adapter.mkdir(path),
                }, `${this.app.vault.configDir}/plugins/${this.manifest.id}-spelling`);
                void this.personalSpellingDictionary.load().catch((error: unknown) => {
                        console.error("[PolyType] Personal spelling dictionary could not be loaded", error);
                });
                const spellingEngine = new SpellingEngine({
                        loader: spellingLoader,
                        settings: () => ({
                                enabled: this.settings.spellingCheckEnabled,
                                underline: this.settings.spellingUnderlineEnabled,
                                languages: this.settings.spellingLanguages,
                                sensitivity: this.settings.spellingSensitivity,
                                excludedPaths: this.settings.personalExcludedPaths,
                                personalDictionaryEnabled: true,
                        }),
                        personalDictionary: {
                                isAllowed: (word, language) =>
                                        this.personalSpellingDictionary.isAllowed(word, language),
                                isIgnored: (word, language) =>
                                        this.personalSpellingDictionary.isIgnored(word, language),
                        },
                        contextRanker: new NGramContextCandidateRanker(multilingualProvider),
                });
                const spellingExtension = createSpellingExtension(
                        () => this.settings,
                        spellingEngine,
                        this.personalSpellingDictionary,
                );
                this.registerEditorExtension([
                        spellingExtension.field,
                        spellingExtension.plugin,
                        spellingExtension.tooltip,
                ]);
                this.registerEditorSuggest(
                        new PolyTypeSuggest(
                                this.app,
                                () => this.settings,
                                loadPredictionAsset,
                                predictionProvider,
                                (event) => {
                                        if (!isEligibleLearningLocation({
                                                file: event.file,
                                                cursorLine: event.cursorLine,
                                                cursorCh: event.cursorCh,
                                                lineText: event.lineText,
                                                textBeforeCursor: event.textBeforeCursor,
                                                metadata: event.metadata,
                                        }, this.settings.personalExcludedPaths)) return;
                                        const recorded = this.personalLearning.recordAcceptedSuggestion(
                                                event.word,
                                                event.context,
                                                event.language,
                                                event.file.path,
                                        );
                                        if (recorded) this.acceptedSuggestionMarker.set(event.editor, {
                                                line: event.cursorLine,
                                                word: english.rules.normalizeWord(event.word),
                                                wordStartCh: event.wordStartCh,
                                                acceptedLineText: event.lineText.slice(0, event.wordStartCh)
                                                        + event.word + event.lineText.slice(event.cursorCh),
                                        });
                                },
                                (language) => {
                                        if (this.settings.languageMode !== "auto" || language === this.settings.language) return;
                                        this.settings.language = language;
                                        void this.saveSettings();
                                },
                                (detected, route) => {
                                        this.lastDetectedLanguage = detected;
                                        this.lastRouteDiagnostic = route;
                                        this.renderLanguageDiagnostic();
                                },
                        )
                );

                void this.personalLearning.load().then(() => {
                        this.personalLearning.setPreferences(
                                this.settings.personalLearningEnabled,
                                this.settings.personalExcludedPaths,
                        );
                        this.registerEvent(this.app.vault.on("delete", (file) => {
                                this.personalLearning.forgetPath(file.path);
                        }));
                        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
                                this.personalLearning.renamePath(oldPath, file.path);
                        }));
                }).catch((error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        console.error("[PolyType] Personal learning data could not be loaded", error);
                        new Notice(`Personal learning is unavailable: ${message}`, 10000);
                });

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

                this.addCommand({
                        id: "personal-learning-status",
                        name: "Show personal learning status",
                        callback: () => new Notice(formatPersonalStatus(this.personalLearning.getStatus()), 10000),
                });
                this.addCommand({
                        id: "personal-learning-retry-save",
                        name: "Retry personal learning save",
                        callback: async () => {
                                try {
                                        await this.personalLearning.retrySave();
                                        new Notice("Personal learning data saved.");
                                } catch (error) {
                                        const message = error instanceof Error ? error.message : String(error);
                                        new Notice(`Could not save personal learning data: ${message}`, 8000);
                                }
                        },
                });
                this.addCommand({
                        id: "personal-learning-reset",
                        name: "Reset personal learning data",
                        callback: () => new ConfirmPersonalResetModal(this.app, async () => {
                                await this.personalLearning.reset();
                                new Notice(getStrings(this.settings.language).modelReset);
                        }, getStrings(this.settings.language)).open(),
                });

                this.registerEvent(
                        this.app.workspace.on("editor-change", (editor, info) => {
                                if (info.file) this.observeTypedCompletion(editor, info.file);
                                this.lastDetectedLanguage = detectLanguage(getEditorTextBeforeCursor(editor, 500));
                                // Never pair a fresh detection with the route of an older result.
                                this.lastRouteDiagnostic = null;
                                this.renderLanguageDiagnostic();
                                if (this.settings.languageMode === "auto") {
	                                        const detected = this.lastDetectedLanguage;

                                        if (detected && detected !== this.settings.language) {
                                                this.settings.language = detected;
                                                void this.saveSettings();
                                        }
                                }

                        })
                );

                this.addSettingTab(new PolyTypeSettingTab(this.app, this));
        }

        onunload(): void {
                // Obsidian's plugin unload hook is synchronous; start and observe a final best-effort flush.
                if (this.personalLearning) void this.personalLearning.dispose();
        }

        async saveSettings(): Promise<void> {
                await this.saveData(this.settings);
        }

        private lastDetectedLanguage: LanguageId | null = null;
        private lastRouteDiagnostic: PredictionRouteDiagnostic | null = null;

        private renderLanguageDiagnostic(): void {
                if (!this.suggestionStatus) return;
                const detected = this.lastDetectedLanguage ?? "—";
                const route = this.lastRouteDiagnostic;
                const request = route?.requestLanguage ?? "—";
                const model = route
                        ? `${route.modelLanguage ?? "—"}/${route.model} (${route.candidateCount})`
                        : "—";
                this.suggestionStatus.setText(`Detected: ${detected} · Request: ${request} · Model: ${model}`);
        }

        async updatePersonalPreferences(enabled: boolean, excludedPaths: string[]): Promise<void> {
                this.settings.personalLearningEnabled = enabled;
                this.settings.personalExcludedPaths = excludedPaths;
                this.personalLearning.setPreferences(enabled, excludedPaths);
                await this.saveSettings();
        }

        async removePersonalSpellingWord(word: string, language: LanguageId): Promise<void> {
                await this.personalSpellingDictionary.remove(word, language);
        }

        getPersonalSpellingEntries() {
                return this.personalSpellingDictionary.getEntries();
        }

        resetPersonalLearning(): Promise<void> {
                return this.personalLearning.reset();
        }

        retryPersonalSave(): Promise<void> {
                return this.personalLearning.retrySave();
        }

        getPersonalLearningStatus() {
                return this.personalLearning.getStatus();
        }

        private observeTypedCompletion(editor: Editor, file: import("obsidian").TFile): void {
                const cursor = editor.getCursor();
                const lineText = editor.getLine(cursor.line);
                const previous = this.previousEditorLine.get(editor);
                this.previousEditorLine.set(editor, { line: cursor.line, text: lineText });
                const marker = this.acceptedSuggestionMarker.get(editor);
                const languageModule = getLanguageModule(this.settings.language);
                const completed = previous && previous.line === cursor.line
                        ? detectCompletedTypedWord(previous.text, lineText, languageModule.rules)
                        : undefined;
                if (marker) {
                        const disposition = classifyAcceptedMarker(marker, cursor.line, lineText, completed);
                        if (disposition !== "keep") this.acceptedSuggestionMarker.delete(editor);
                        if (disposition !== "discard") return;
                }
                if (!completed) return;

                if (!this.personalLearning.isEnabled || this.settings.language !== "en") return;

                const metadata = this.app.metadataCache.getFileCache(file);
                const cursorOffset = editor.posToOffset(cursor);
                const start = editor.offsetToPos(Math.max(0, cursorOffset - 512));
                if (!isEligibleLearningLocation({
                        file,
                        cursorLine: cursor.line,
                        cursorCh: cursor.ch,
                        lineText,
                        textBeforeCursor: editor.getRange(start, cursor),
                        metadata,
                }, this.settings.personalExcludedPaths)) return;
                this.personalLearning.recordTypedWord(completed.word, completed.context, this.settings.language, file.path);
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
                        .setName(strings.maxSuggestions)
                        .setDesc(strings.maxSuggestionsDescription)
                        .addDropdown((dropdown) => {
                                for (let count = 1; count <= 10; count++) {
                                        dropdown.addOption(String(count), String(count));
                                }
                                dropdown
                                        .setValue(String(this.plugin.settings.maxSuggestions))
                                        .onChange(async (value) => {
                                                const count = Number(value);
                                                if (!Number.isInteger(count) || count < 1 || count > 10) return;
                                                this.plugin.settings.maxSuggestions = count;
                                                await this.plugin.saveSettings();
                                        });
                        });

                new Setting(containerEl)
                        .setName(strings.languageMode)
                        .addDropdown((dropdown) => {
                                dropdown
                                        .addOption("auto", strings.automatic)
                                        .addOption("manual", strings.manual)
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

                new Setting(containerEl)
                        .setName(strings.spellingCheck)
                        .setDesc(strings.spellingCheckDescription)
                        .addToggle((toggle) => toggle
                                .setValue(this.plugin.settings.spellingCheckEnabled)
                                .onChange(async (enabled) => {
                                        this.plugin.settings.spellingCheckEnabled = enabled;
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName(strings.spellingUnderline)
                        .setDesc(strings.spellingUnderlineDescription)
                        .addToggle((toggle) => toggle
                                .setValue(this.plugin.settings.spellingUnderlineEnabled)
                                .onChange(async (enabled) => {
                                        this.plugin.settings.spellingUnderlineEnabled = enabled;
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName(strings.spellingSensitivity)
                        .addDropdown((dropdown) => dropdown
                                .addOption("highPrecision", strings.spellingHighPrecision)
                                .addOption("balanced", strings.spellingBalanced)
                                .addOption("broad", strings.spellingBroad)
                                .setValue(this.plugin.settings.spellingSensitivity)
                                .onChange(async (value) => {
                                        this.plugin.settings.spellingSensitivity =
                                                value as PolyTypeSettings["spellingSensitivity"];
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName(strings.spellingLanguages)
                        .setDesc(getSupportedLanguages().map((language) => language.displayName).join(", "));
                for (const language of getSupportedLanguages()) {
                        new Setting(containerEl)
                                .setName(language.displayName)
                                .addToggle((toggle) => toggle
                                        .setValue(this.plugin.settings.spellingLanguages.includes(language.id))
                                        .onChange(async (enabled) => {
                                                const languages = new Set(this.plugin.settings.spellingLanguages);
                                                if (enabled) languages.add(language.id);
                                                else languages.delete(language.id);
                                                this.plugin.settings.spellingLanguages = [...languages];
                                                await this.plugin.saveSettings();
                                        }));
                }

                const personalEntries = this.plugin.getPersonalSpellingEntries();
                if (personalEntries.length === 0) {
                        new Setting(containerEl)
                                .setName(strings.spellingPersonalWords)
                                .setDesc(strings.disabled);
                } else {
                        for (const entry of personalEntries) {
                                new Setting(containerEl)
                                        .setName(`${entry.word} (${entry.language})`)
                                        .addButton((button) => button
                                                .setButtonText(strings.spellingRemoveWord)
                                                .onClick(async () => {
                                                        await this.plugin.removePersonalSpellingWord(
                                                                entry.word,
                                                                entry.language,
                                                        );
                                                        this.display();
                                                }));
                        }
                }

                new Setting(containerEl)
                        .setName(strings.experimentalOanc)
                        .setDesc(strings.experimentalOancDescription)
                        .addToggle((toggle) => toggle
                                .setValue(this.plugin.settings.experimentalOancEnabled)
                                .onChange(async (enabled) => {
                                        this.plugin.settings.experimentalOancEnabled = enabled;
                                        await this.plugin.saveSettings();
                                        this.display();
                                }));

                new Setting(containerEl)
                        .setName(strings.personalLearning)
                        .setDesc(strings.personalLearningDescription)
                        .addToggle((toggle) => toggle
                                .setValue(this.plugin.settings.personalLearningEnabled)
                                .onChange(async (enabled) => {
                                        await this.plugin.updatePersonalPreferences(
                                                enabled,
                                                this.plugin.settings.personalExcludedPaths,
                                        );
                                        new Notice(enabled ? strings.learningOn : strings.learningOff);
                                        this.display();
                                }));

                let pendingExclusions = this.plugin.settings.personalExcludedPaths.join("\n");
                new Setting(containerEl)
                        .setName(strings.excludedPaths)
                        .setDesc(strings.excludedPathsDescription)
                        .addTextArea((textArea) => {
                                textArea.setValue(pendingExclusions);
                                textArea.onChange((value) => { pendingExclusions = value; });
                                textArea.inputEl.rows = 4;
                        });
                new Setting(containerEl)
                        .addButton((button) => button
                                .setButtonText(strings.saveExclusions)
                                .onClick(async () => {
                                        const paths = pendingExclusions.split("\n").map((path) => path.trim()).filter(Boolean);
                                        await this.plugin.updatePersonalPreferences(
                                                this.plugin.settings.personalLearningEnabled,
                                                [...new Set(paths)],
                                        );
                                        this.display();
                                }));

                const status = this.plugin.getPersonalLearningStatus();
                const statusSetting = new Setting(containerEl)
                        .setName(strings.personalStats)
                        .setDesc(formatPersonalStatus(status, strings));
                if (status.dirty || status.error) {
                        statusSetting.addButton((button) => button
                                .setButtonText(strings.retrySave)
                                .onClick(async () => {
                                        try {
                                                await this.plugin.retryPersonalSave();
                                                new Notice(strings.saveRetryCompleted);
                                        } catch (error) {
                                                const message = error instanceof Error ? error.message : String(error);
                                                new Notice(`${strings.saveRetryFailed}: ${message}`, 8000);
                                        }
                                        this.display();
                                }));
                }
                new Setting(containerEl)
                        .setName(strings.resetPersonalModel)
                        .addButton((button) => button
                                .setButtonText(strings.reset)
                                .setWarning()
                                .onClick(() => new ConfirmPersonalResetModal(this.app,
                                        async () => {
                                                await this.plugin.resetPersonalLearning();
                                                new Notice(strings.modelReset);
                                                this.display();
                                        }, strings).open()));
        }
}

class ConfirmPersonalResetModal extends Modal {
	constructor(app: PolyTypePlugin["app"], private readonly confirm: () => Promise<void>,
		private readonly strings: ReturnType<typeof getStrings>) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("p", { text: this.strings.confirmReset });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.strings.cancel).onClick(() => this.close()))
			.addButton((button) => button.setButtonText(this.strings.reset).setWarning().onClick(async () => {
				try {
					await this.confirm();
					this.close();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`Could not reset personal learning data: ${message}`, 8000);
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function formatPersonalStatus(
	status: ReturnType<PolyTypePlugin["getPersonalLearningStatus"]>,
	strings = getStrings(),
): string {
	const size = status.fileBytes < 1024 * 1024
		? `${(status.fileBytes / 1024).toFixed(1)} KiB`
		: `${(status.fileBytes / (1024 * 1024)).toFixed(2)} MiB`;
	const state = status.error ?? (status.loaded ? (status.enabled ? strings.enabled : strings.disabled) : "Loading");
	const unsaved = status.dirty ? `\n${strings.unsavedChanges}` : "";
	return `${state}${unsaved}\n${strings.accepted}: ${status.acceptedSuggestions}\n${strings.typedWords}: ${status.typedWords}\n${strings.wordTypes}: ${status.wordTypes}\n${strings.contextTypes}: ${status.bigramTypes} / ${status.trigramTypes}\n${strings.trackedNotes}: ${status.notes}\n${strings.modelSize}: ${size}`;
}
