import { Plugin, PluginSettingTab, Setting } from "obsidian";
import { getStrings } from "./i18n";
import { getSupportedLanguages } from "./language/registry";
import type { LanguageId } from "./language/types";
import { DEFAULT_SETTINGS } from "./settings";
import type { PolyTypeSettings } from "./settings";

export default class PolyTypePlugin extends Plugin {
	settings: PolyTypeSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
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
