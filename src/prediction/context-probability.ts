/** Complete (unpruned) context statistics required by absolute discounting. */
export interface ContextDistribution {
	counts: ReadonlyMap<string, number>;
	contextTotal: number;
	continuationTypes: number;
}

export interface RetainedContextDistribution {
	counts: ReadonlyMap<string, number>;
	contextTotal: number;
	continuationTypes: number;
	backoffMass?: number;
}

/**
 * Absolute discount interpolation for one context. contextTotal and
 * continuationTypes must come from unpruned training statistics; retained
 * Binary successor sums are not suitable substitutes.
 */
export function absoluteDiscountProbability(
	word: string,
	distribution: ContextDistribution,
	lowerOrderProbability: number,
	discount: number,
): number {
	validateDistribution(distribution, discount);
	if (!Number.isFinite(lowerOrderProbability) || lowerOrderProbability < 0 || lowerOrderProbability > 1) {
		throw new RangeError("Lower order probability must be finite and between 0 and 1");
	}
	if (distribution.contextTotal === 0) return lowerOrderProbability;
	const count = distribution.counts.get(word) ?? 0;
	const retainedProbability = Math.max(count - discount, 0) / distribution.contextTotal;
	const backoffMass = discount * distribution.continuationTypes / distribution.contextTotal;
	return retainedProbability + backoffMass * lowerOrderProbability;
}

/** Applies successive context distributions from shortest to longest. */
export function interpolatedAbsoluteDiscount(
	word: string,
	unigramCount: number,
	unigramTotal: number,
	distributions: readonly ContextDistribution[],
	discount: number,
): number {
	if (!Number.isFinite(unigramCount) || unigramCount < 0 || !Number.isFinite(unigramTotal) || unigramTotal < 0) {
		throw new RangeError("Unigram counts must be finite and non-negative");
	}
	let probability = unigramTotal > 0 ? unigramCount / unigramTotal : 0;
	for (const distribution of distributions) {
		probability = absoluteDiscountProbability(word, distribution, probability, discount);
	}
	return probability;
}

function validateDistribution(distribution: ContextDistribution, discount: number): void {
	if (!Number.isFinite(discount) || discount < 0 || discount >= 1) {
		throw new RangeError("Absolute discount must be finite and in [0, 1)");
	}
	if (!Number.isFinite(distribution.contextTotal) || distribution.contextTotal < 0
		|| !Number.isSafeInteger(distribution.continuationTypes) || distribution.continuationTypes < 0) {
		throw new RangeError("Context statistics must be finite and non-negative");
	}
	let sum = 0;
	for (const count of distribution.counts.values()) {
		if (!Number.isFinite(count) || count < 0) throw new RangeError("N-gram counts must be finite and non-negative");
		sum += count;
	}
	if (sum !== distribution.contextTotal || distribution.continuationTypes !== distribution.counts.size) {
		throw new RangeError("Context statistics must contain complete, unpruned n-gram counts");
	}
}
