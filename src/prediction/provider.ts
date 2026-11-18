import type { PredictionProvider } from "./types";

/** Empty local provider placeholder. Prediction algorithms are intentionally not implemented. */
export class EmptyPredictionProvider implements PredictionProvider {
	async predict(): Promise<readonly string[]> {
		return [];
	}
}
