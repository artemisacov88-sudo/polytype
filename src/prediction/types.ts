import type { LanguageId } from "../language/types";

export interface PredictionRequest {
	/** Previous words, ordered from oldest to newest. */
	context: readonly string[];
	language: LanguageId;
	currentWord: string;
	/** Maximum number of suggestions to return; absent/invalid values preserve the five-item default. */
	maxSuggestions?: number;
	/** Internal, code-only route trace for the exact prediction result. */
	routeDiagnostic?: (route: PredictionRouteDiagnostic) => void;
}

export interface PredictionRouteDiagnostic {
	requestLanguage: LanguageId;
	modelLanguage: LanguageId | null;
	model: "ngram" | "dictionary" | "standard" | "none" | "unknown";
	candidateCount: number;
}

export interface PredictionProvider {
	predict(request: PredictionRequest): Promise<readonly string[]>;
}

export function getMaxSuggestions(request: PredictionRequest): number {
	const value = request.maxSuggestions;
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10 ? value : 5;
}
