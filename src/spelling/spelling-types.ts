import type { LanguageId } from "../language/types";

export interface SpellingWord {
	surfaceForm: string;
	searchForm: string;
	searchAliases: readonly string[];
	from: number;
	to: number;
	language?: LanguageId;
}

export interface SpellingCandidate {
	word: string;
	searchForm: string;
	searchAliases?: readonly string[];
	confidence: number;
	distance?: number;
}

export interface SpellingIssue {
	word: SpellingWord;
	candidates: readonly SpellingCandidate[];
	confidence: number;
}

export interface SpellingResult {
	issues: readonly SpellingIssue[];
	checkedWordCount: number;
}

export interface LengthEditDistanceThreshold {
	minLength: number;
	maxLength: number;
	maxDistance: number;
}

export interface EditDistanceProfile {
	language: LanguageId;
	lengthThresholds: readonly LengthEditDistanceThreshold[];
	insertionWeight: number;
	deletionWeight: number;
	substitutionWeight: number;
	transpositionWeight: number;
	repeatedLetterPenalty: number;
	confidenceFloor: number;
}

export interface SpellingLanguageProfile {
	language: LanguageId;
	normalizeForSearch(word: string): string;
	searchAliases(word: string): readonly string[];
	editDistance: EditDistanceProfile;
	ignoreCapitalizedWords: boolean;
	ignoreAbbreviations: boolean;
	ignoreTechnicalTokens: boolean;
}

export interface SpellingDictionaryEntry {
	surfaceForm: string;
	searchForm: string;
	searchAliases: readonly string[];
	frequency: number;
	pos: string;
}

export interface SpellingDictionary {
	language: LanguageId;
	entries: readonly SpellingDictionaryEntry[];
	has(searchForm: string): boolean;
	get(searchForm: string): SpellingDictionaryEntry | undefined;
}

export type SpellingSensitivity = "highPrecision" | "balanced" | "broad";

export interface SpellingSettings {
	enabled: boolean;
	underline: boolean;
	languages: readonly LanguageId[];
	sensitivity: SpellingSensitivity;
	excludedPaths: readonly string[];
	personalDictionaryEnabled: boolean;
}
