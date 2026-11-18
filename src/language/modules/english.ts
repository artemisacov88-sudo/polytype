import type { LanguageModule } from "../types";

export const english: LanguageModule = {
	id: "en",
	displayName: "Английский",

	rules: {
		tokenize(text: string): string[] {
			return text.match(/[a-z]+(?:['’-][a-z]+)*/giu) ?? [];
		},

		normalizeWord(word: string): string {
			return word.toLocaleLowerCase("en-US");
		},
	},
};