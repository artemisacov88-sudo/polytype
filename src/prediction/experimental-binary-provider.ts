import type { PredictionProvider, PredictionRequest } from "./types";
import { DictionaryPredictionProvider } from "./provider";
import type { CandidateEvidence } from "./ranking";
import { generateCandidates } from "./candidate-generation";
import { rankExperimentalCandidates } from "./experimental-ranking";
import { findCollocationCandidates, type CollocationData } from "./collocations";
import {
	DEFAULT_OANC_NGRAM_BINARY_PATH,
	DEFAULT_OANC_NGRAM_MANIFEST_PATH,
	NGramModelLoader,
	type NGramBinaryReader,
	type NGramContextStatisticsReader,
	type NGramManifestReader,
	type OancBinaryNGramModel,
} from "./ngram-model-loader";
import type { PredictionDataLoader } from "./data-source";
import { interpolatedPrunedAbsoluteDiscount, preparePrunedContextDistribution } from "./backoff-smoothing";
import type { RetainedContextDistribution } from "./context-probability";

export type ExperimentalPredictionAlgorithm = "longest-context" | "interpolated-absolute-discount";

export interface PredictionComparison {
	baseline: readonly string[];
	experimental: readonly string[];
	error?: string;
	algorithm?: ExperimentalPredictionAlgorithm;
}

/**
 * Opt-in comparison provider. The normal DictionaryPredictionProvider remains
 * the default; binary loading starts only when an English comparison is asked.
 */
export class ExperimentalBinaryPredictionProvider implements PredictionProvider {
	private readonly baselineProvider: DictionaryPredictionProvider;
	private readonly modelLoader: NGramModelLoader;
	private collocations: Promise<CollocationData | null> | undefined;
	private reportedLoadError = false;

	constructor(
		loadPredictionAsset: PredictionDataLoader,
		readBinary: NGramBinaryReader,
		readManifest: NGramManifestReader,
		private readonly onModelError: (message: string) => void = (message) => console.error(message),
		binaryPath = DEFAULT_OANC_NGRAM_BINARY_PATH,
		manifestPath = DEFAULT_OANC_NGRAM_MANIFEST_PATH,
		readContextStatistics?: NGramContextStatisticsReader,
	) {
		this.baselineProvider = new DictionaryPredictionProvider(loadPredictionAsset);
		this.modelLoader = new NGramModelLoader(readBinary, readManifest, binaryPath, manifestPath,
			undefined, readContextStatistics);
	}

	async predict(request: PredictionRequest): Promise<readonly string[]> {
		return (await this.compare(request)).experimental;
	}

	async compare(
		request: PredictionRequest,
		algorithm: ExperimentalPredictionAlgorithm = "longest-context",
	): Promise<PredictionComparison> {
		const baseline = await this.baselineProvider.predict(request);
		if (request.language !== "en" || !request.currentWord) {
			return { baseline, experimental: baseline };
		}

		let model: OancBinaryNGramModel;
		try {
			model = await this.modelLoader.load();
			this.reportedLoadError = false;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!this.reportedLoadError) {
				this.reportedLoadError = true;
				try {
					this.onModelError(message);
				} catch (reportingError) {
					console.error("[PolyType] Could not report an experimental model error", reportingError);
				}
			}
			return { baseline, experimental: baseline, error: message };
		}

		const prefix = request.currentWord.toLocaleLowerCase("en-US");
		let predictions: ReturnType<OancBinaryNGramModel["lookupContinuations"]> | undefined;
		for (let length = Math.min(3, request.context.length); length > 0; length--) {
			const found = model.lookupContinuations(request.context.slice(-length), prefix, 20);
			if (found.continuations.length > 0) {
				predictions = found;
				break;
			}
		}
		const baselineEvidence: CandidateEvidence[] = [];
		const trieCandidates = await this.baselineProvider.getEnglishPrefixCandidates(prefix, 50);
		for (const word of [...new Set([...baseline, ...trieCandidates])]) {
			baselineEvidence.push({ word, frequency: model.getWordFrequency(word) });
		}
		const contextualEvidence: CandidateEvidence[] = [];
		const contextLayers: RetainedContextDistribution[] = [];
		for (let length = 1; length <= Math.min(3, request.context.length); length++) {
			const context = request.context.slice(-length);
			const rows = model.getRetainedContinuations(context);
			for (const row of rows) {
				if (!row.word.startsWith(prefix)) continue;
				contextualEvidence.push({
					word: row.word,
					frequency: model.getWordFrequency(row.word),
					ngramCount: row.frequency,
					ngramContextCount: model.getContextStatistics(context)?.total ?? 0,
					ngramContextLength: length,
				});
			}
			const statistics = model.getContextStatistics(context);
			if (statistics) {
				const counts = new Map(rows.map(({ word, frequency }) => [word, frequency]));
				contextLayers.push(preparePrunedContextDistribution({
					counts,
					contextTotal: statistics.total,
					continuationTypes: statistics.continuationTypes,
				}, OANC_ABSOLUTE_DISCOUNT));
			}
		}

		const previousWord = request.context[request.context.length - 1] ?? "";
		const collocations = previousWord ? await this.getCollocations() : null;
		const collocationEvidence = collocations
			? findCollocationCandidates(collocations, previousWord, prefix).map((partner) => ({
				word: partner.word,
				frequency: model.getWordFrequency(partner.word),
				collocationScore: partner.score,
				collocationCount: partner.count,
			}))
			: [];
		const unigramEvidence = model.lookupFullUnigrams(prefix, 50).continuations.map(({ word, frequency }) => ({
			word,
			frequency,
		}));
		const canInterpolate = algorithm === "interpolated-absolute-discount" && contextLayers.length > 0;
		const candidateEvidence = !canInterpolate
			? (predictions?.continuations ?? []).map((prediction) => ({
				word: prediction.word,
				frequency: model.getWordFrequency(prediction.word),
				ngramCount: prediction.frequency,
				ngramContextCount: prediction.contextFrequency,
				ngramContextLength: prediction.contextLength,
			}))
			: contextualEvidence;
		const candidates = generateCandidates(prefix,
			[baselineEvidence, unigramEvidence, candidateEvidence, collocationEvidence], 100);
		let scoredCandidates = candidates;
		let actualAlgorithm = algorithm;
		if (algorithm === "interpolated-absolute-discount") {
			if (!canInterpolate) {
				actualAlgorithm = "longest-context";
			} else {
				scoredCandidates = candidates.map((candidate) => ({
					...candidate,
					ngramProbability: interpolatedPrunedAbsoluteDiscount(candidate.word,
						model.getWordProbability(candidate.word), contextLayers, OANC_ABSOLUTE_DISCOUNT),
				}));
			}
		}
		const experimental = rankExperimentalCandidates(scoredCandidates, model.maxWordFrequency)
			.slice(0, 5)
			.map(({ word }) => word);
		return { baseline, experimental, algorithm: actualAlgorithm };
	}

	private getCollocations(): Promise<CollocationData | null> {
		if (!this.collocations) {
			this.collocations = this.baselineProvider.loadExperimentalAsset<unknown>("english-collocations.json")
				.then((data) => isCollocationData(data) ? data : null)
				.catch(() => null);
		}
		return this.collocations;
	}
}

export const OANC_ABSOLUTE_DISCOUNT = 0.25;

function isCollocationData(value: unknown): value is CollocationData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value as Record<string, unknown>).every((relations) =>
		!!relations && typeof relations === "object" && !Array.isArray(relations)
		&& Object.values(relations as Record<string, unknown>).every((partners) =>
			Array.isArray(partners) && partners.every((partner) => !!partner && typeof partner === "object"
				&& typeof (partner as { word?: unknown }).word === "string"
				&& typeof (partner as { count?: unknown }).count === "number"
				&& typeof (partner as { score?: unknown }).score === "number")),
	);
}
