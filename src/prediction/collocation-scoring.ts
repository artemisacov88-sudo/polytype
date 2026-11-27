import type { CandidateEvidence } from "./ranking";

/** Collocation is a bounded additive feature, never a candidate source by itself. */
export function collocationFeature(candidate: CandidateEvidence): number {
	const rawScore = candidate.collocationScore ?? 0;
	const rawCount = candidate.collocationCount ?? 0;
	const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore / 14)) : 0;
	const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
	return score * (count / (count + 5));
}
