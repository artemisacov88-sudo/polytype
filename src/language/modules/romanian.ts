import type { LanguageModule } from "../types";

export const romanian: LanguageModule = {
	id: "ro",
	displayName: "Румынский",

	rules: {
		tokenize(text: string): string[] {
			return text.match(/[a-zăâîșț]+/giu) ?? [];
		},

		normalizeWord(word: string): string {
			return word.toLocaleLowerCase("ro-RO");
		},
	},
};