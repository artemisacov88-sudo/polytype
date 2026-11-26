import type { CandidateEvidence } from "./ranking";

/** Merges independently generated sources into a bounded candidate pool. */
export function generateCandidates(
	prefix: string,
	sources: readonly (readonly CandidateEvidence[])[],
	maximum = 100,
	normalizeWord: (word: string) => string = (word) => word.toLocaleLowerCase("en-US"),
	isValidCandidate: (word: string) => boolean = isValidEnglishCandidate,
): CandidateEvidence[] {
	if (!prefix || maximum <= 0) return [];
	const normalizedPrefix = normalizeWord(prefix);
	const byWord = new Map<string, CandidateEvidence>();
	for (const source of sources) {
		for (const candidate of source) {
			const word = normalizeWord(candidate.word);
			if (!word.startsWith(normalizedPrefix) || !isValidCandidate(word)) continue;
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

/** OANC transcripts contain the nonstandard object-pronoun contraction "them's". */
export function isValidEnglishCandidate(word: string): boolean {
	return !/^them['’]s$/u.test(word.toLocaleLowerCase("en-US"));
}
