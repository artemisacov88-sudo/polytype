
import type { LanguageModule } from "../types";

export const russian: LanguageModule = {
	id: "ru",
	displayName: "Русский",

	rules: {
		tokenize(text: string): string[] {
			return text.match(/[а-яё]+/giu) ?? [];
		},

		normalizeWord(word: string): string {
			return word.normalize("NFC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
		},
	},
};
