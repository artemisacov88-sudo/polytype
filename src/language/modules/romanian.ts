import type { LanguageModule } from "../types";

export const romanian: LanguageModule = {
	id: "ro",
	displayName: "Румынский",

	rules: {
		tokenize(text: string): string[] {
			return text.normalize("NFC").match(/[a-zăâîșțşţ]+/giu) ?? [];
		},

		normalizeWord(word: string): string {
			return word.normalize("NFC").toLocaleLowerCase("ro-RO").replace(/ş/g, "ș").replace(/ţ/g, "ț");
		},
	},
};
