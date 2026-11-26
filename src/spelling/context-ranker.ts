import type { LanguageId } from "../language/types";
import type { SpellingCandidate } from "./spelling-types";

export interface SpellingNGramModelProvider {
	getContextEvidence(
		language: LanguageId,
		context: readonly string[],
		word: string,
	): Promise<{ count: number; contextFrequency: number; contextLength: number } | undefined>;
}

export class NGramContextCandidateRanker {
	constructor(private readonly models: SpellingNGramModelProvider) {}

	async rank(
		language: LanguageId,
		context: readonly string[],
		candidates: readonly SpellingCandidate[],
	): Promise<readonly SpellingCandidate[]> {
		if (candidates.length === 0) return candidates;
		const ranked: SpellingCandidate[] = [];
		for (const candidate of candidates) {
			const evidence = await this.models.getContextEvidence(language, context, candidate.searchForm);
			const contextBonus = evidence
				? (evidence.count / Math.max(1, evidence.contextFrequency))
					* 0.18 * evidence.contextLength / 3
				: 0;
			ranked.push({ ...candidate, confidence: Math.min(1, candidate.confidence + contextBonus) });
		}
		return ranked
			.sort((left, right) => right.confidence - left.confidence
				|| (left.distance ?? 99) - (right.distance ?? 99)
				|| left.word.localeCompare(right.word));
	}
}
