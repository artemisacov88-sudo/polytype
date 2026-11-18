import type { LanguageId, LanguageModule } from "./types";

const languageNames: Record<LanguageId, string> = {
	ru: "Русский",
	en: "English",
	de: "Deutsch",
	ro: "Română",
};

/** Lists supported language identifiers; language rules can be registered here later. */
export function getSupportedLanguages(): Array<Pick<LanguageModule, "id" | "displayName">> {
	return (Object.entries(languageNames) as Array<[LanguageId, string]>).map(([id, displayName]) => ({
		id,
		displayName,
	}));
}
