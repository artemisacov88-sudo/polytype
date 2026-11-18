import type { LanguageId } from "../language/types";

const strings: Record<LanguageId, { settings: string; language: string }> = {
	ru: { settings: "Настройки PolyType", language: "Язык" },
	en: { settings: "PolyType settings", language: "Language" },
	de: { settings: "PolyType-Einstellungen", language: "Sprache" },
	ro: { settings: "Setări PolyType", language: "Limbă" },
};

export function getStrings(language: LanguageId) {
	return strings[language];
}
