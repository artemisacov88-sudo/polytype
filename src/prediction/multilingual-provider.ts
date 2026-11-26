import { getLanguageModule } from "../language/registry";
import type { LanguageId } from "../language/types";
import { generateCandidates } from "./candidate-generation";
import { NGramModelLoader, type NGramBinaryReader, type NGramContextStatisticsReader,
	type OancBinaryNGramModel } from "./ngram-model-loader";
import { rankCandidates, type CandidateEvidence } from "./ranking";
import { getMaxSuggestions, type PredictionProvider, type PredictionRequest } from "./types";
import { WordIndex, type WordIndexEntry } from "./index/word-index";

const NON_ENGLISH_LANGUAGES: readonly LanguageId[] = ["ru", "de", "ro"];

export type LocalTextReader = (path: string) => Promise<string>;
export interface DetailedPredictionResult {
	candidatePool: readonly string[];
	suggestions: readonly string[];
}

/** Local language-specific dictionaries and PTNG models; English stays on its existing provider. */
export class MultilingualPredictionProvider implements PredictionProvider {
	private readonly wordIndexes = new Map<LanguageId, Promise<WordIndex | null>>();
	private readonly modelLoaders = new Map<LanguageId, NGramModelLoader>();
	private readonly models = new Map<LanguageId, Promise<OancBinaryNGramModel | null>>();
	private readonly failedModels = new Set<LanguageId>();
	private readonly reportedErrors = new Set<string>();
	private activeLanguage: LanguageId | undefined;

	constructor(
		private readonly standardProvider: PredictionProvider,
		private readonly readText: LocalTextReader,
		private readonly readBinary: NGramBinaryReader,
		private readonly onDataError: (message: string) => void = (message) => console.error(message),
		private readonly assetDirectory: (language: LanguageId) => string =
			(language) => `data/multilingual/${language}`,
	) {
		for (const language of NON_ENGLISH_LANGUAGES) {
			const base = this.assetDirectory(language);
			this.modelLoaders.set(language, new NGramModelLoader(
				this.readBinary,
				this.readText,
				`${base}/binary/model.ptng`,
				`${base}/manifest.json`,
				undefined,
				this.readBinary as NGramContextStatisticsReader,
				getLanguageModule(language).rules.normalizeWord,
				language,
			));
		}
	}

	async predict(request: PredictionRequest): Promise<readonly string[]> {
		return (await this.predictDetailed(request)).suggestions;
	}

	async getContextEvidence(
		language: LanguageId,
		context: readonly string[],
		word: string,
	): Promise<{ count: number; contextFrequency: number; contextLength: number } | undefined> {
		if (language === "en") {
			const provider = this.standardProvider as PredictionProvider & {
				getContextEvidence?: (
					context: readonly string[],
					word: string,
				) => { count: number; contextFrequency: number; contextLength: number } | undefined;
			};
			return provider.getContextEvidence?.(
				context.map((item) => getLanguageModule("en").rules.normalizeWord(item)),
				getLanguageModule("en").rules.normalizeWord(word),
			);
		}
		const model = await this.getModel(language);
		if (!model) return undefined;
		const rules = getLanguageModule(language).rules;
		const normalizedContext = context.map((item) => rules.normalizeWord(item)).slice(-3);
		const normalizedWord = rules.normalizeWord(word);
		for (let length = normalizedContext.length; length > 0; length--) {
			const lookup = model.lookupContinuations(normalizedContext.slice(-length), normalizedWord, 100);
			const continuation = lookup.continuations.find((item) => item.word === normalizedWord);
			if (continuation) {
				return {
					count: continuation.frequency,
					contextFrequency: lookup.contextFrequency,
					contextLength: length,
				};
			}
		}
		return undefined;
	}

	async predictDetailed(request: PredictionRequest): Promise<DetailedPredictionResult> {
		this.activateLanguage(request.language);
		if (request.language === "en") {
			const suggestions = await this.standardProvider.predict(request);
			request.routeDiagnostic?.({ requestLanguage: request.language, modelLanguage: "en", model: "standard", candidateCount: suggestions.length });
			return { candidatePool: suggestions, suggestions };
		}
		const language = request.language;
		const rules = getLanguageModule(language).rules;
		const prefix = rules.normalizeWord(request.currentWord);
		if (!prefix) {
			request.routeDiagnostic?.({ requestLanguage: language, modelLanguage: null, model: "none", candidateCount: 0 });
			return { candidatePool: [], suggestions: [] };
		}

		const model = await this.getModel(language);
		if (!model) {
			// The dictionary is a recovery path. Keeping a large Trie alongside a
			// healthy binary model wastes memory and delays the first prediction.
			const wordIndex = await this.getWordIndex(language);
			const dictionaryCandidates = wordIndex?.suggest(prefix, 50).map((word) => ({
				word: rules.normalizeWord(word),
				frequency: wordIndex.getEntry(word)?.frequency ?? 0,
			})) ?? [];
			const candidatePool = dictionaryCandidates.map(({ word }) => word);
			const suggestions = candidatePool.slice(0, getMaxSuggestions(request));
			request.routeDiagnostic?.({ requestLanguage: language, modelLanguage: null, model: "dictionary", candidateCount: candidatePool.length });
			return { candidatePool, suggestions };
		}

		const context = request.context.map((word) => rules.normalizeWord(word)).slice(-3);
		const unigramCandidates: CandidateEvidence[] = model.lookupFullUnigrams(prefix, 50).continuations.map((entry) => ({
			word: entry.word,
			frequency: entry.frequency,
		}));
		const contextualCandidates: CandidateEvidence[] = [];
		for (let length = 1; length <= context.length; length++) {
			const lookup = model.lookupContinuations(context.slice(-length), prefix, 100);
			for (const entry of lookup.continuations) {
				contextualCandidates.push({
					word: entry.word,
					frequency: model.getWordFrequency(entry.word),
					ngramCount: entry.frequency,
					ngramContextCount: lookup.contextFrequency,
					ngramContextLength: length,
				});
			}
		}
		const candidates = generateCandidates(prefix,
			[unigramCandidates, contextualCandidates], 100, rules.normalizeWord, () => true);
		const suggestions = rankCandidates(candidates, model.maxWordFrequency)
			.slice(0, getMaxSuggestions(request)).map(({ word }) => word);
		request.routeDiagnostic?.({ requestLanguage: language, modelLanguage: language, model: "ngram", candidateCount: candidates.length });
		return { candidatePool: candidates.map(({ word }) => word), suggestions };
	}

	private getWordIndex(language: LanguageId): Promise<WordIndex | null> {
		let pending = this.wordIndexes.get(language);
		if (!pending) {
			pending = this.readText(`${this.assetDirectory(language)}/words.json`)
				.then((contents) => JSON.parse(contents) as unknown)
				.then((value) => {
					if (!isWordIndexEntries(value, getLanguageModule(language).rules.normalizeWord)) {
						throw new Error("word dictionary is malformed");
					}
					return new WordIndex(value);
				})
				.catch((error: unknown) => {
					this.reportOnce(`${language}-dictionary`, `Could not load ${language} word dictionary: ${describe(error)}`);
					return null;
				});
			this.wordIndexes.set(language, pending);
		}
		return pending;
	}

	private getModel(language: LanguageId): Promise<OancBinaryNGramModel | null> {
		if (this.failedModels.has(language)) return Promise.resolve(null);
		let pending = this.models.get(language);
		if (!pending) {
			pending = this.modelLoaders.get(language)!.load().catch((error: unknown) => {
				this.failedModels.add(language);
				this.reportOnce(`${language}-model`, `Could not load ${language} language model: ${describe(error)}`);
				return null;
			});
			// Keep a failed result for this plugin session to avoid rereading a
			// missing/corrupt model on every keystroke. Reloading the plugin retries.
			this.models.set(language, pending);
		}
		return pending;
	}

	private activateLanguage(language: LanguageId): void {
		if (this.activeLanguage === language) return;
		for (const other of NON_ENGLISH_LANGUAGES) {
			if (other === language) continue;
			this.models.delete(other);
			this.wordIndexes.delete(other);
			if (!this.failedModels.has(other)) this.modelLoaders.get(other)?.reset();
		}
		this.activeLanguage = language;
	}

	private reportOnce(key: string, message: string): void {
		if (this.reportedErrors.has(key)) return;
		this.reportedErrors.add(key);
		try { this.onDataError(message); }
		catch (error) { console.error("[PolyType] Could not report a multilingual asset error", error); }
	}
}

function isWordIndexEntries(
	value: unknown,
	normalizeWord: (word: string) => string,
): value is WordIndexEntry[] {
	return Array.isArray(value) && value.length > 0 && value.every((entry: unknown) => {
		if (!entry || typeof entry !== "object") return false;
		const record = entry as Record<string, unknown>;
		return typeof record.word === "string" && record.word.length > 0
			&& normalizeWord(record.word) === record.word
			&& typeof record.frequency === "number" && Number.isSafeInteger(record.frequency)
			&& record.frequency > 0 && typeof record.pos === "string";
	});
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
