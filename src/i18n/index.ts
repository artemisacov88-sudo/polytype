import type { LanguageId } from "../language/types";
import { en } from "./en";
import { de } from "./de";
import { ro } from "./ro";
import { ru } from "./ru";

export interface PolyTypeStrings {
	pluginName: string;
	settings: string;
	language: string;
	enabled: string;
	disabled: string;
	noSuggestions: string;
	languageMode: string;
	maxSuggestions: string;
	maxSuggestionsDescription: string;
	spellingCheck: string;
	spellingCheckDescription: string;
	spellingTypo: string;
	spellingUnderline: string;
	spellingUnderlineDescription: string;
	spellingLanguages: string;
	spellingSensitivity: string;
	spellingHighPrecision: string;
	spellingBalanced: string;
	spellingBroad: string;
	spellingIgnoreWord: string;
	spellingAddToDictionary: string;
	spellingRemoveWord: string;
	spellingPersonalWords: string;
	automatic: string;
	manual: string;
	personalLearning: string;
	personalLearningDescription: string;
	experimentalOanc: string;
	experimentalOancDescription: string;
	excludedPaths: string;
	excludedPathsDescription: string;
	saveExclusions: string;
	personalStats: string;
	accepted: string;
	typedWords: string;
	wordTypes: string;
	contextTypes: string;
	trackedNotes: string;
	modelSize: string;
	unsavedChanges: string;
	retrySave: string;
	saveRetryCompleted: string;
	saveRetryFailed: string;
	resetPersonalModel: string;
	confirmReset: string;
	cancel: string;
	reset: string;
	learningOn: string;
	learningOff: string;
	modelReset: string;
}

const translations: Record<LanguageId, PolyTypeStrings> = { en, de, ro, ru };

export function getStrings(language: LanguageId = "ru"): PolyTypeStrings {
	return translations[language] ?? ru;
}
