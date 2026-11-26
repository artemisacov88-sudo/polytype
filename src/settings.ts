
import type { LanguageId } from "./language/types";

export type LanguageMode = "auto" | "manual";

export interface PolyTypeSettings {
	language: LanguageId;
	languageMode: LanguageMode;
	maxSuggestions: number;
	spellingCheckEnabled: boolean;
	spellingUnderlineEnabled: boolean;
	spellingLanguages: readonly LanguageId[];
	spellingSensitivity: "highPrecision" | "balanced" | "broad";
	personalLearningEnabled: boolean;
	personalExcludedPaths: string[];
	experimentalOancEnabled: boolean;
}

export const DEFAULT_SETTINGS: PolyTypeSettings = {
	language: "ru",
	languageMode: "manual",
	maxSuggestions: 5,
	spellingCheckEnabled: true,
	spellingUnderlineEnabled: true,
	spellingLanguages: ["ru", "en", "de", "ro"],
	spellingSensitivity: "highPrecision",
	personalLearningEnabled: false,
	personalExcludedPaths: [],
	experimentalOancEnabled: false,
};

const LANGUAGE_IDS = new Set<LanguageId>(["ru", "en", "de", "ro"]);

/** Validates persisted settings and safely defaults unknown or malformed values. */
export function normalizeSettings(value: unknown): PolyTypeSettings {
	const stored = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const language = typeof stored.language === "string" && LANGUAGE_IDS.has(stored.language as LanguageId)
		? stored.language as LanguageId
		: DEFAULT_SETTINGS.language;
	const languageMode = stored.languageMode === "auto" || stored.languageMode === "manual"
		? stored.languageMode
		: DEFAULT_SETTINGS.languageMode;
	const maxSuggestions = typeof stored.maxSuggestions === "number"
		&& Number.isInteger(stored.maxSuggestions) && stored.maxSuggestions >= 1 && stored.maxSuggestions <= 10
		? stored.maxSuggestions
		: DEFAULT_SETTINGS.maxSuggestions;
	const personalExcludedPaths = Array.isArray(stored.personalExcludedPaths)
		? [...new Set(stored.personalExcludedPaths
			.filter((path): path is string => typeof path === "string")
			.map((path) => path.trim())
			.filter(Boolean))]
		: [...DEFAULT_SETTINGS.personalExcludedPaths];
	return {
		language,
		languageMode,
		maxSuggestions,
		spellingCheckEnabled: typeof stored.spellingCheckEnabled === "boolean"
			? stored.spellingCheckEnabled
			: DEFAULT_SETTINGS.spellingCheckEnabled,
		spellingUnderlineEnabled: typeof stored.spellingUnderlineEnabled === "boolean"
			? stored.spellingUnderlineEnabled
			: DEFAULT_SETTINGS.spellingUnderlineEnabled,
		spellingLanguages: Array.isArray(stored.spellingLanguages)
			? [...new Set(stored.spellingLanguages.filter((language): language is LanguageId =>
				typeof language === "string" && LANGUAGE_IDS.has(language as LanguageId)))]
			: [...DEFAULT_SETTINGS.spellingLanguages],
		spellingSensitivity: stored.spellingSensitivity === "highPrecision"
			|| stored.spellingSensitivity === "balanced"
			|| stored.spellingSensitivity === "broad"
			? stored.spellingSensitivity
			: DEFAULT_SETTINGS.spellingSensitivity,
		personalLearningEnabled: typeof stored.personalLearningEnabled === "boolean"
			? stored.personalLearningEnabled
			: DEFAULT_SETTINGS.personalLearningEnabled,
		personalExcludedPaths,
		experimentalOancEnabled: typeof stored.experimentalOancEnabled === "boolean"
			? stored.experimentalOancEnabled
			: DEFAULT_SETTINGS.experimentalOancEnabled,
	};
}
