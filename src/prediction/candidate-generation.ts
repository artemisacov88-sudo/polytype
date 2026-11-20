import type { CandidateEvidence } from "./ranking";

/** Merges independently generated sources into a bounded candidate pool. */
export function generateCandidates(
	prefix: string,
	sources: readonly (readonly CandidateEvidence[])[],
	maximum = 100,
): CandidateEvidence[] {
	if (!prefix || maximum <= 0) return [];
	const normalizedPrefix = prefix.toLocaleLowerCase("en-US");
	const byWord = new Map<string, CandidateEvidence>();
	for (const source of sources) {
		for (const candidate of source) {
			const word = candidate.word.toLocaleLowerCase("en-US");
			if (!word.startsWith(normalizedPrefix)) continue;
			const previous = byWord.get(word);
			if (!previous) {
				byWord.set(word, { ...candidate, word });
				continue;
			}
			byWord.set(word, {
				...previous,
				frequency: Math.max(previous.frequency, candidate.frequency),
				ngramCount: Math.max(previous.ngramCount ?? 0, candidate.ngramCount ?? 0),
				ngramContextCount: Math.max(previous.ngramContextCount ?? 0, candidate.ngramContextCount ?? 0),
				ngramContextLength: Math.max(previous.ngramContextLength ?? 0, candidate.ngramContextLength ?? 0),
				collocationScore: Math.max(previous.collocationScore ?? 0, candidate.collocationScore ?? 0),
				collocationCount: Math.max(previous.collocationCount ?? 0, candidate.collocationCount ?? 0),
			});
		}
	}
	return [...byWord.values()]
		.sort((left, right) => right.frequency - left.frequency || left.word.localeCompare(right.word))
		.slice(0, maximum);
}
