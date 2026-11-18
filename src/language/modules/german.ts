import type { LanguageModule } from "../types";

export const german: LanguageModule = {
	id: "de",
	displayName: "Немецкий",

	rules: {
		tokenize(text: string): string[] {
			return text.match(/[a-zäöüß]+(?:['’-][a-zäöüß]+)*/giu) ?? [];
		},

		normalizeWord(word: string): string {
			return word.toLocaleLowerCase("de-DE");
		},
	},
};