import type { PredictionProvider, PredictionRequest } from "./types";
import { englishCorpus } from "./corpus/english";
import { NGramModel } from "./ngram";
import { english } from "../language/modules/english";
import { WordIndex, type WordIndexEntry } from "./index/word-index";
import { findCollocationCandidates, type CollocationData } from "./collocations";
import { rankCandidates, type CandidateEvidence } from "./ranking";
import {
	invalidDataError,
	loadLocalJson,
	type PredictionDataAsset,
	type PredictionDataErrorHandler,
	type PredictionDataLoader,
} from "./data-source";

const englishModel = new NGramModel(
        englishCorpus,
        english.rules.tokenize,
        english.rules.normalizeWord,
);

export class DictionaryPredictionProvider implements PredictionProvider {
	private englishWordIndex: Promise<WordIndex | null> | undefined;
	private englishCollocations: Promise<CollocationData | null> | undefined;
	private readonly reportedErrors = new Set<PredictionDataAsset>();

	constructor(
		private readonly loadAsset: PredictionDataLoader,
		private readonly onDataError: PredictionDataErrorHandler = (message) => console.error(message),
	) {}

	private loadJson<T>(asset: PredictionDataAsset): Promise<T> {
		return loadLocalJson<T>(this.loadAsset, asset);
	}

	/** Shared local asset reader for isolated experimental providers. */
	loadExperimentalAsset<T>(asset: PredictionDataAsset): Promise<T> {
		return this.loadJson<T>(asset);
	}

	private getEnglishWordIndex(): Promise<WordIndex | null> {
		if (!this.englishWordIndex) {
			this.englishWordIndex = this.loadJson<unknown>("english-words.json")
				.then((data) => {
					if (!isWordIndexEntries(data)) {
						throw invalidDataError("english-words.json", "expected an array of word, frequency, and POS records");
					}
					return new WordIndex(data);
				})
				.then((index) => {
					this.reportedErrors.delete("english-words.json");
					return index;
				})
				.catch((error: unknown) => {
					this.reportLoadError("english-words.json", error);
					this.englishWordIndex = undefined;
					return null;
				});
		}
		return this.englishWordIndex;
	}

	/** Prefix candidates from the existing Trie, exposed to isolated experiment providers. */
	async getEnglishPrefixCandidates(prefix: string, limit = 50): Promise<string[]> {
		const index = await this.getEnglishWordIndex();
		return index?.suggest(prefix, limit) ?? [];
	}

	private getEnglishCollocations(): Promise<CollocationData | null> {
		if (!this.englishCollocations) {
			this.englishCollocations = this.loadJson<unknown>("english-collocations.json")
				.then((data) => {
					if (!isCollocationData(data)) {
						throw invalidDataError("english-collocations.json", "expected a map of headwords to partner lists");
					}
					return data;
				})
				.then((data) => {
					this.reportedErrors.delete("english-collocations.json");
					return data;
				})
				.catch((error: unknown) => {
					this.reportLoadError("english-collocations.json", error);
					this.englishCollocations = undefined;
					return null;
				});
		}
		return this.englishCollocations;
	}

	private reportLoadError(asset: PredictionDataAsset, error: unknown): void {
		if (this.reportedErrors.has(asset)) return;
		this.reportedErrors.add(asset);
		const message = error instanceof Error
			? error.message
			: `[PolyType] Failed to load local resource "${asset}": ${String(error)}`;
		try {
			this.onDataError(message);
		} catch (reportingError) {
			console.error("[PolyType] Could not report a local data error", reportingError);
		}
	}

        async predict(request: PredictionRequest): Promise<readonly string[]> {
                const prefix = request.currentWord.toLocaleLowerCase();

                if (!prefix) return [];

                if (request.language === "en") {
			const wordIndex = await this.getEnglishWordIndex();
			const evidence = new Map<string, CandidateEvidence>();

			// Trie keeps prefix lookup local to the matching branch; 50 lexical
			// candidates leave room for context signals to promote less common words.
			if (wordIndex) {
				for (const word of wordIndex.suggest(prefix, 50)) {
					evidence.set(word, {
						word,
						frequency: wordIndex.getEntry(word)?.frequency ?? 0,
					});
				}
			}

			for (const prediction of englishModel.predictScored(request.context, prefix, 20)) {
				const candidate = evidence.get(prediction.word) ?? {
					word: prediction.word,
					frequency: wordIndex?.getEntry(prediction.word)?.frequency ?? 0,
				};
				candidate.ngramCount = prediction.count;
				candidate.ngramContextCount = prediction.contextCount;
				candidate.ngramContextLength = prediction.contextLength;
				evidence.set(prediction.word, candidate);
			}

			const previousWord = request.context[request.context.length - 1];
			if (previousWord) {
				const collocations = await this.getEnglishCollocations();
				for (const partner of collocations
					? findCollocationCandidates(collocations, previousWord, prefix)
					: []) {
					const candidate = evidence.get(partner.word) ?? {
						word: partner.word,
						frequency: wordIndex?.getEntry(partner.word)?.frequency ?? 0,
					};
					candidate.collocationScore = Math.max(candidate.collocationScore ?? 0, partner.score);
					candidate.collocationCount = Math.max(candidate.collocationCount ?? 0, partner.count);
					evidence.set(partner.word, candidate);
				}
			}

			return rankCandidates([...evidence.values()], wordIndex?.maxFrequency ?? 0)
				.slice(0, 5)
				.map(({ word }) => word);
                }
		return [];
        }
}

function isWordIndexEntries(value: unknown): value is WordIndexEntry[] {
	return Array.isArray(value) && value.every((entry: unknown) => {
		if (!entry || typeof entry !== "object") return false;
		const record = entry as Record<string, unknown>;
		return typeof record.word === "string" && record.word.length > 0
			&& typeof record.frequency === "number" && Number.isFinite(record.frequency) && record.frequency >= 0
			&& typeof record.pos === "string";
	});
}

function isCollocationData(value: unknown): value is CollocationData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value as Record<string, unknown>).every((relations) => {
		if (!relations || typeof relations !== "object" || Array.isArray(relations)) return false;
		return Object.values(relations as Record<string, unknown>).every((partners) =>
			Array.isArray(partners) && partners.every((partner: unknown) => {
				if (!partner || typeof partner !== "object") return false;
				const record = partner as Record<string, unknown>;
				return typeof record.word === "string"
					&& typeof record.count === "number" && Number.isFinite(record.count)
					&& typeof record.score === "number" && Number.isFinite(record.score);
			}),
		);
	});
}
