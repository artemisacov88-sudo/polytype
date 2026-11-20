export type PredictionDataAsset = "english-words.json" | "english-collocations.json";

/** Reads a bundled local data asset without involving a network service. */
export type PredictionDataLoader = (asset: PredictionDataAsset) => Promise<string>;

export type PredictionDataErrorHandler = (message: string) => void;

export class PredictionDataError extends Error {
	constructor(asset: PredictionDataAsset, operation: "read" | "parse" | "validate", detail: string) {
		super(`[PolyType] Could not ${operation} local resource "${asset}": ${detail}`);
		this.name = "PredictionDataError";
	}
}

/** Reads and parses one local JSON resource, adding context to IO/JSON errors. */
export async function loadLocalJson<T>(
	loader: PredictionDataLoader,
	asset: PredictionDataAsset,
): Promise<T> {
	let contents: string;
	try {
		contents = await loader(asset);
	} catch (error) {
		throw new PredictionDataError(asset, "read", describeError(error));
	}

	try {
		return JSON.parse(contents) as T;
	} catch (error) {
		throw new PredictionDataError(asset, "parse", describeError(error));
	}
}

export function invalidDataError(asset: PredictionDataAsset, detail: string): PredictionDataError {
	return new PredictionDataError(asset, "validate", detail);
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
