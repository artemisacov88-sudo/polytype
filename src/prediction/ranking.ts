export interface CandidateEvidence {
	word: string;
	frequency: number;
	ngramCount?: number;
	ngramContextCount?: number;
	ngramContextLength?: number;
	ngramProbability?: number;
	collocationScore?: number;
	collocationCount?: number;
}

export interface RankedCandidate extends CandidateEvidence {
	score: number;
}

/** Combines normalized OANC frequency, contextual counts, and collocation evidence. */
export function rankCandidates(
	candidates: readonly CandidateEvidence[],
	maximumFrequency: number,
	maximumContextLength = 3,
): RankedCandidate[] {
	const frequencyScale = Math.log1p(Math.max(0, maximumFrequency));
	return candidates
		.map((candidate) => {
			const frequency = frequencyScale > 0
				? Math.log1p(Math.max(0, candidate.frequency)) / frequencyScale
				: 0;
			const count = Math.max(0, candidate.ngramCount ?? 0);
			const total = Math.max(0, candidate.ngramContextCount ?? 0);
			const contextLength = Math.max(0, candidate.ngramContextLength ?? 0);
			const specificity = Math.min(1, (contextLength + 1) / (maximumContextLength + 1));
			const contextual = total > 0
				? (count / total) * (count / (count + 2)) * specificity
				: 0;
			const collocationCount = Math.max(0, candidate.collocationCount ?? 0);
			const collocationScore = Math.max(0, Math.min(1, (candidate.collocationScore ?? 0) / 14));
			const collocation = collocationScore * (collocationCount / (collocationCount + 5));

			return {
				...candidate,
				score: 0.25 * frequency + 0.65 * contextual + 0.10 * collocation,
			};
		})
		.sort((a, b) => b.score - a.score || b.frequency - a.frequency || a.word.localeCompare(b.word));
}
