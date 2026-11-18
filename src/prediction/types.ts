import type { LanguageId } from "../language/types";

export interface PredictionRequest {
	/** Previous words, ordered from oldest to newest. */
	context: readonly string[];
	language: LanguageId;
	currentWord: string;
}

export interface PredictionProvider {
	predict(request: PredictionRequest): Promise<readonly string[]>;
}
