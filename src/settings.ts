import type { LanguageId } from "./language/types";

export interface PolyTypeSettings {
	language: LanguageId;
}

export const DEFAULT_SETTINGS: PolyTypeSettings = {
	language: "en",
};
