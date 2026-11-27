import type { LanguageId } from "../language/types";
import { getLanguageModule } from "../language/registry";
import { normalizeSpellingSurface } from "./normalization";
import type { EditDistanceProfile, SpellingLanguageProfile } from "./spelling-types";

const LANGUAGE_PROFILES: Record<LanguageId, SpellingLanguageProfile> = {
	ru: createLanguageProfile("ru"),
	en: createLanguageProfile("en"),
	de: createLanguageProfile("de"),
	ro: createLanguageProfile("ro"),
};

export function getSpellingLanguageProfile(language: LanguageId): SpellingLanguageProfile {
	return LANGUAGE_PROFILES[language];
}

export function getSupportedSpellingLanguageProfiles(): readonly SpellingLanguageProfile[] {
	const supportedLanguages: readonly LanguageId[] = ["ru", "en", "de", "ro"];
	return supportedLanguages.map((language) => LANGUAGE_PROFILES[language]);
}

function createLanguageProfile(language: LanguageId): SpellingLanguageProfile {
	const languageModule = getLanguageModule(language);
	const editDistance: EditDistanceProfile = {
		language,
		lengthThresholds: [],
		insertionWeight: 1,
		deletionWeight: 1,
		substitutionWeight: 1,
		transpositionWeight: 1,
		repeatedLetterPenalty: 0,
		confidenceFloor: 0,
	};

	return {
		language,
		normalizeForSearch: (word) => languageModule.rules.normalizeWord(word),
		searchAliases: (word) => normalizeSpellingSurface(word, language).searchAliases,
		editDistance,
		ignoreCapitalizedWords: true,
		ignoreAbbreviations: true,
		ignoreTechnicalTokens: true,
	};
}
