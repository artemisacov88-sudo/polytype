
import type { LanguageId } from "./language/types";

export type LanguageMode = "auto" | "manual";

export interface PolyTypeSettings {
	language: LanguageId;
	languageMode: LanguageMode;
}

export const DEFAULT_SETTINGS: PolyTypeSettings = {
	language: "ru",
	languageMode: "manual",
};
