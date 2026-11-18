
import type { LanguageId, LanguageModule } from "./types";

import { russian } from "./modules/russian";
import { english } from "./modules/english";
import { german } from "./modules/german";
import { romanian } from "./modules/romanian";

const languages: Record<LanguageId, LanguageModule> = {
	ru: russian,
	en: english,
	de: german,
	ro: romanian,
};

export function getSupportedLanguages(): Array<Pick<LanguageModule, "id" | "displayName">> {
	return Object.values(languages).map(({ id, displayName }) => ({
		id,
		displayName,
	}));
}

export function getLanguageModule(id: LanguageId): LanguageModule {
	return languages[id];
}
