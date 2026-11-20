import type { CandidateEvidence, RankedCandidate } from "./ranking";
import { collocationFeature } from "./collocation-scoring";

export interface RankingWeights {
	probability: number;
	frequency: number;
	contextReliability: number;
	collocation: number;
}

export const DEFAULT_EXPERIMENTAL_WEIGHTS: RankingWeights = {
	probability: 1,
	frequency: 0,
	contextReliability: 0.1,
	collocation: 0.15,
};

/** Ranks only the supplied pool; candidate generation remains independent. */
export function rankExperimentalCandidates(
	candidates: readonly CandidateEvidence[],
	maximumFrequency: number,
	maximumContextLength = 3,
	weights: RankingWeights = DEFAULT_EXPERIMENTAL_WEIGHTS,
): RankedCandidate[] {
	const sum = weights.probability + weights.frequency + weights.contextReliability + weights.collocation;
	if (!Number.isFinite(sum) || sum <= 0 || Object.values(weights).some((value) => !Number.isFinite(value) || value < 0)) {
		throw new RangeError("Ranking weights must be finite, non-negative, and have positive sum");
	}
	const frequencyScale = Math.log1p(nonNegative(maximumFrequency));
	const probabilities = candidates.map((candidate) => {
		if (candidate.ngramProbability !== undefined) return nonNegative(candidate.ngramProbability);
		const count = nonNegative(candidate.ngramCount ?? 0);
		const total = nonNegative(candidate.ngramContextCount ?? 0);
		return total > 0 ? Math.min(1, count / total) : 0;
	});
	const maximumProbability = Math.max(0, ...probabilities);
	return candidates.map((candidate, index) => {
		const rawFrequency = nonNegative(candidate.frequency);
		const frequency = frequencyScale > 0 ? Math.log1p(rawFrequency) / frequencyScale : 0;
		const conditional = maximumProbability > 0 ? probabilities[index] / maximumProbability : 0;
		const length = nonNegative(candidate.ngramContextLength ?? 0);
		const reliability = Math.min(1, length / Math.max(1, maximumContextLength));
		const score = (weights.probability * conditional + weights.frequency * frequency
			+ weights.contextReliability * reliability + weights.collocation * collocationFeature(candidate)) / sum;
		return { ...candidate, score };
	}).sort((left, right) => right.score - left.score
		|| right.frequency - left.frequency
		|| left.word.localeCompare(right.word));
}

function nonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}
