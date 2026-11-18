export type LanguageId = "ru" | "en" | "de" | "ro";

/** Text operations a language module can provide as language-specific rules are added. */
export interface LanguageTextRules {
	 tokenize(text: string): string[];
	 normalizeWord(word: string): string;
}

export interface LanguageModule {
	id: LanguageId;
	displayName: string;
	rules: LanguageTextRules;
}
