import type { RetainedContextDistribution } from "./context-probability";

/** Computes the retained probability mass once per context, then reuses it. */
export function preparePrunedContextDistribution(
	distribution: Omit<RetainedContextDistribution, "backoffMass">,
	discount: number,
): RetainedContextDistribution {
	if (!Number.isFinite(discount) || discount < 0 || discount >= 1
		|| !Number.isFinite(distribution.contextTotal) || distribution.contextTotal <= 0
		|| !Number.isSafeInteger(distribution.continuationTypes)
		|| distribution.continuationTypes < distribution.counts.size) {
		throw new RangeError("Full context statistics are required for pruned-model interpolation");
	}
	let retainedDiscountedMass = 0;
	for (const count of distribution.counts.values()) {
		if (!Number.isFinite(count) || count <= 0 || count > distribution.contextTotal) {
			throw new RangeError("Retained context counts are inconsistent with full statistics");
		}
		retainedDiscountedMass += Math.max(count - discount, 0) / distribution.contextTotal;
	}
	if (retainedDiscountedMass > 1 + 1e-12) {
		throw new RangeError("Retained context counts exceed the full context total");
	}
	return { ...distribution, backoffMass: Math.max(0, 1 - retainedDiscountedMass) };
}

/**
 * Uses full train-only context totals, while assigning all mass omitted from
 * the pruned Binary continuation table to shorter contexts.
 */
export function interpolatedPrunedAbsoluteDiscount(
	word: string,
	unigramProbability: number,
	distributions: readonly RetainedContextDistribution[],
	discount: number,
): number {
	if (!Number.isFinite(unigramProbability) || unigramProbability < 0 || unigramProbability > 1) {
		throw new RangeError("Unigram probability must be finite and between 0 and 1");
	}
	let probability = unigramProbability;
	for (const distribution of distributions) {
		const prepared = distribution.backoffMass === undefined
			? preparePrunedContextDistribution(distribution, discount)
			: distribution;
		const count = distribution.counts.get(word) ?? 0;
		const observed = Math.max(count - discount, 0) / distribution.contextTotal;
		probability = observed + prepared.backoffMass! * probability;
	}
	return probability;
}
