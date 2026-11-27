import { getMaxSuggestions, type PredictionProvider, type PredictionRequest } from "../prediction/types";
import { PersonalModel } from "./personal-model";

/** Adds a bounded personal preference layer without replacing the OANC provider. */
export class PersonalizedPredictionProvider implements PredictionProvider {
	constructor(
		private readonly baseProvider: PredictionProvider,
		private readonly getModel: () => PersonalModel | undefined,
		private readonly isEnabled: () => boolean,
		private readonly maximumPersonalWeight = 0.35,
		private readonly priorObservations = 50,
	) {}

	async predict(request: PredictionRequest): Promise<readonly string[]> {
		const baseline = await this.baseProvider.predict(request);
		if (request.language !== "en" || !this.isEnabled()) return baseline;
		const model = this.getModel();
		if (!model) return baseline;

		const prefix = request.currentWord.toLocaleLowerCase("en-US");
		if (!prefix) return baseline;
		const evidence = model.getContextEvidence(request.context, prefix, 20);
		const personalCandidates = model.getPrefixCandidates(prefix, 10);
		const candidates = [...new Set([...baseline, ...personalCandidates,
			...(evidence?.candidates.map(({ word }) => word) ?? [])])];
		if (candidates.length === 0) return baseline;

		if (!evidence || evidence.observations <= 0) return baseline;
		const personalCounts = new Map(evidence.candidates.map(({ word, count }) => [word, count]));
		const baseWeights = new Map(baseline.map((word, index) => [word, 1 / (index + 1)]));
		let baseTotal = 0;
		for (const value of baseWeights.values()) baseTotal += value;
		const confidence = Math.min(this.maximumPersonalWeight,
			evidence.observations / (evidence.observations + this.priorObservations));
		return candidates.map((word, index) => {
			const base = (baseWeights.get(word) ?? 0) / (baseTotal || 1);
			const personal = (personalCounts.get(word) ?? 0) / evidence.observations;
			return { word, score: (1 - confidence) * base + confidence * personal, index };
		}).sort((left, right) => right.score - left.score
			|| (baseWeights.get(right.word) ?? 0) - (baseWeights.get(left.word) ?? 0)
			|| left.index - right.index
			|| left.word.localeCompare(right.word))
			.slice(0, getMaxSuggestions(request))
			.map(({ word }) => word);
	}
}
