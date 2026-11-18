
import type { LanguageId } from "../language/types";

const strings = {
	settings: "Настройки PolyType",
	language: "Язык обработки текста",
};

export function getStrings(_language?: LanguageId) {
	return strings;
}

