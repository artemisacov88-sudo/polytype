import { english } from "../language/modules/english";
import { Trie } from "../prediction/index/trie";

export type PersonalLanguage = "en";
export const PERSONAL_MODEL_VERSION = 1;
// The 300-note / 6,000-row ceilings bound the serialized UTF-8 model below
// storage's 5 MiB hard limit even with maximum-length English tokens and paths.
export const PERSONAL_MODEL_LIMITS = {
	maxNotes: 300,
	maxAcceptedSuggestions: 250_000,
	maxWordTypes: 6_000,
	maxBigramTypes: 6_000,
	maxTrigramTypes: 6_000,
	maxNoteStatisticRows: 6_000,
} as const;
const MAX_CONTEXT_WORDS = 3;

export interface PersonalNGramCount {
	/** Context is ordered from oldest to newest; empty context denotes unigram fallback. */
	context: readonly string[];
	word: string;
	count: number;
}

export interface PersonalModelStatistics {
	language: PersonalLanguage;
	acceptedSuggestions: number;
	typedWords: number;
	unigrams: ReadonlyMap<string, number>;
	bigrams: readonly PersonalNGramCount[];
	trigrams: readonly PersonalNGramCount[];
}

export interface SerializedPersonalNote {
	path: string;
	acceptedSuggestions: number;
	typedWords: number;
	unigrams: Array<[string, number]>;
	bigrams: PersonalNGramCount[];
	trigrams: PersonalNGramCount[];
}

export interface SerializedPersonalModel {
	version: typeof PERSONAL_MODEL_VERSION;
	language: PersonalLanguage;
	notes: SerializedPersonalNote[];
}

export interface PersonalModelUsage {
	acceptedSuggestions: number;
	typedWords: number;
	wordTypes: number;
	bigramTypes: number;
	trigramTypes: number;
	notes: number;
	trackedRows: number;
}

interface MutableStatistics {
	acceptedSuggestions: number;
	typedWords: number;
	unigrams: Map<string, number>;
	/** Previous word -> accepted next word -> count. */
	bigrams: Map<string, Map<string, number>>;
	/** JSON-encoded two-word context -> accepted next word -> count. */
	trigrams: Map<string, Map<string, number>>;
}

/**
 * In-memory statistics of explicitly accepted English suggestions.
 * This module has no Obsidian, persistence, or prediction-provider dependency.
 */
export class PersonalModel {
	private readonly aggregate = createStatistics();
	private readonly notes = new Map<string, MutableStatistics>();
	private personalTrie = new Trie();
	private trackedRows = 0;
	private aggregateBigramTypes = 0;
	private aggregateTrigramTypes = 0;

	/** Records one accepted word. Invalid input leaves all model state unchanged. */
	registerAcceptedSuggestion(
		word: string,
		context: readonly string[],
		language: string,
		notePath: string,
	): boolean {
		return this.registerObservation(word, context, language, notePath, "accepted");
	}

	registerTypedWord(word: string, context: readonly string[], language: string, notePath: string): boolean {
		return this.registerObservation(word, context, language, notePath, "typed");
	}

	private registerObservation(
		word: string,
		context: readonly string[],
		language: string,
		notePath: string,
		source: "accepted" | "typed",
	): boolean {
		if (language !== "en" || !isValidPath(notePath) || !Array.isArray(context)
			|| context.length > MAX_CONTEXT_WORDS) return false;

		const normalizedWord = normalizeSingleEnglishWord(word);
		if (!normalizedWord) return false;

		const normalizedContext: string[] = [];
		for (const token of context) {
			if (typeof token !== "string") return false;
			const normalizedToken = normalizeSingleEnglishWord(token);
			if (!normalizedToken) return false;
			normalizedContext.push(normalizedToken);
		}

		const path = notePath;
		const noteStatistics = this.notes.get(path);
		const bigramContext = normalizedContext.slice(-1);
		const trigramContext = normalizedContext.slice(-2);
		const addsWordType = !this.aggregate.unigrams.has(normalizedWord);
		const addsBigramType = bigramContext.length > 0
			&& !this.aggregate.bigrams.get(contextKey(bigramContext))?.has(normalizedWord);
		const addsTrigramType = trigramContext.length > 1
			&& !this.aggregate.trigrams.get(contextKey(trigramContext))?.has(normalizedWord);
		const addsNoteRows = Number(!noteStatistics?.unigrams.has(normalizedWord))
			+ Number(bigramContext.length > 0 && !noteStatistics?.bigrams.get(contextKey(bigramContext))?.has(normalizedWord))
			+ Number(trigramContext.length > 1 && !noteStatistics?.trigrams.get(contextKey(trigramContext))?.has(normalizedWord));
		if ((!noteStatistics && this.notes.size >= PERSONAL_MODEL_LIMITS.maxNotes)
			|| this.aggregate.acceptedSuggestions + this.aggregate.typedWords >= PERSONAL_MODEL_LIMITS.maxAcceptedSuggestions
			|| (addsWordType && this.aggregate.unigrams.size >= PERSONAL_MODEL_LIMITS.maxWordTypes)
			|| (addsBigramType && this.aggregateBigramTypes >= PERSONAL_MODEL_LIMITS.maxBigramTypes)
			|| (addsTrigramType && this.aggregateTrigramTypes >= PERSONAL_MODEL_LIMITS.maxTrigramTypes)
			|| this.trackedRows + addsNoteRows > PERSONAL_MODEL_LIMITS.maxNoteStatisticRows) return false;

		const noteBucket = noteStatistics ?? createStatistics();

		applyObservation(this.aggregate, normalizedWord, normalizedContext, source);
		applyObservation(noteBucket, normalizedWord, normalizedContext, source);
		if (!noteStatistics) this.notes.set(path, noteBucket);
		this.trackedRows += addsNoteRows;
		if (addsBigramType) this.aggregateBigramTypes++;
		if (addsTrigramType) this.aggregateTrigramTypes++;
		this.personalTrie.insert({ word: normalizedWord, frequency: this.aggregate.unigrams.get(normalizedWord) ?? 1 });
		return true;
	}

	/** Returns an isolated snapshot of all accepted-suggestion statistics. */
	getStatistics(): PersonalModelStatistics {
		return snapshotStatistics(this.aggregate);
	}

	getUsage(): PersonalModelUsage {
		return {
			acceptedSuggestions: this.aggregate.acceptedSuggestions,
			typedWords: this.aggregate.typedWords,
			wordTypes: this.aggregate.unigrams.size,
			bigramTypes: this.aggregateBigramTypes,
			trigramTypes: this.aggregateTrigramTypes,
			notes: this.notes.size,
			trackedRows: this.trackedRows,
		};
	}

	getNotePaths(): string[] {
		return [...this.notes.keys()].sort((left, right) => left.localeCompare(right));
	}

	renameNote(oldPath: string, newPath: string): boolean {
		if (!isValidPath(oldPath) || !isValidPath(newPath) || oldPath === newPath) return false;
		const source = this.notes.get(oldPath);
		if (!source) return false;
		const target = this.notes.get(newPath);
		if (!target) {
			this.notes.delete(oldPath);
			this.notes.set(newPath, source);
			return true;
		}
		const oldRows = countStatisticsRows(source) + countStatisticsRows(target);
		mergeStatistics(target, source);
		this.notes.delete(oldPath);
		this.trackedRows = Math.max(0, this.trackedRows - oldRows + countStatisticsRows(target));
		return true;
	}

	getPrefixCandidates(prefix: string, limit = 10): string[] {
		if (limit <= 0) return [];
		return this.personalTrie.suggest(english.rules.normalizeWord(prefix), limit).map(({ word }) => word);
	}

	/** Returns the longest personal context with prefix-matching continuations. */
	getContextCandidates(context: readonly string[], prefix: string, limit = 20): PersonalNGramCount[] {
		return this.getContextEvidence(context, prefix, limit)?.candidates ?? [];
	}

	getContextEvidence(context: readonly string[], prefix: string, limit = 20): {
		contextLength: number;
		observations: number;
		candidates: PersonalNGramCount[];
	} | undefined {
		if (limit <= 0 || !Array.isArray(context)) return undefined;
		const normalizedContext: string[] = [];
		for (const token of context) {
			const normalized = normalizeSingleEnglishWord(token);
			if (!normalized) return undefined;
			normalizedContext.push(normalized);
		}
		const normalizedPrefix = english.rules.normalizeWord(prefix);
		if (!normalizedPrefix) return undefined;
		for (let length = Math.min(2, normalizedContext.length); length >= 1; length--) {
			const key = contextKey(normalizedContext.slice(-length));
			const source = length === 2 ? this.aggregate.trigrams : this.aggregate.bigrams;
			const continuations = source.get(key);
			if (!continuations) continue;
			const candidates = [...continuations]
				.filter(([word]) => word.startsWith(normalizedPrefix))
				.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
				.slice(0, limit)
				.map(([word, count]) => ({ context: normalizedContext.slice(-length), word, count }));
			if (candidates.length > 0) {
				let observations = 0;
				for (const count of continuations.values()) observations += count;
				return { contextLength: length, observations, candidates };
			}
		}
		const candidates = [...this.aggregate.unigrams]
			.filter(([word]) => word.startsWith(normalizedPrefix))
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
			.slice(0, limit)
			.map(([word, count]) => ({ context: [], word, count }));
		if (candidates.length === 0) return undefined;
		return { contextLength: 0, observations: this.aggregate.acceptedSuggestions + this.aggregate.typedWords, candidates };
	}

	/** Returns undefined when this note has not contributed to the model. */
	getNoteStatistics(notePath: string): PersonalModelStatistics | undefined {
		if (!isValidPath(notePath)) return undefined;
		const statistics = this.notes.get(notePath);
		return statistics ? snapshotStatistics(statistics) : undefined;
	}

	/**
	 * Removes this note's complete contribution. Repeated calls are harmless;
	 * subtraction clamps at zero so corrupted or inconsistent counts cannot go negative.
	 */
	excludeNote(notePath: string): boolean {
		if (!isValidPath(notePath)) return false;
		const path = notePath;
		const statistics = this.notes.get(path);
		if (!statistics) return false;

		this.aggregateBigramTypes = Math.max(0,
			this.aggregateBigramTypes - countRemovableEntries(this.aggregate.bigrams, statistics.bigrams));
		this.aggregateTrigramTypes = Math.max(0,
			this.aggregateTrigramTypes - countRemovableEntries(this.aggregate.trigrams, statistics.trigrams));
		applyStatistics(this.aggregate, statistics, -1);
		this.notes.delete(path);
		this.trackedRows = Math.max(0, this.trackedRows - countStatisticsRows(statistics));
		this.rebuildPersonalTrie();
		return true;
	}

	/** Serializes note contributions only; aggregate counts are derived on load. */
	toJSON(): SerializedPersonalModel {
		return {
			version: PERSONAL_MODEL_VERSION,
			language: "en",
			notes: this.getNotePaths().map((path) => {
				const statistics = this.notes.get(path)!;
				const snapshot = snapshotStatistics(statistics);
				return {
					path,
					acceptedSuggestions: snapshot.acceptedSuggestions,
					typedWords: snapshot.typedWords,
					unigrams: [...snapshot.unigrams].sort(([left], [right]) => left.localeCompare(right)),
					bigrams: [...snapshot.bigrams],
					trigrams: [...snapshot.trigrams],
				};
			}),
		};
	}

	static fromJSON(value: unknown): PersonalModel {
		if (!isRecord(value) || value.version !== PERSONAL_MODEL_VERSION || value.language !== "en"
			|| !Array.isArray(value.notes) || value.notes.length > PERSONAL_MODEL_LIMITS.maxNotes) {
			throw new Error("Unsupported or malformed personal model data");
		}
		const model = new PersonalModel();
		const seenPaths = new Set<string>();
		for (const rawNote of value.notes) {
			const note = parseSerializedNote(rawNote);
			if (seenPaths.has(note.path)) throw new Error("Duplicate note path in personal model");
			seenPaths.add(note.path);
			model.restoreNote(note);
		}
		return model;
	}

	private restoreNote(note: SerializedPersonalNote): void {
		const noteStatistics = createStatistics();
		noteStatistics.acceptedSuggestions = note.acceptedSuggestions;
		noteStatistics.typedWords = note.typedWords;
		for (const [word, count] of note.unigrams) noteStatistics.unigrams.set(word, count);
		for (const item of note.bigrams) changeNestedCount(noteStatistics.bigrams, item.context, item.word, item.count);
		for (const item of note.trigrams) changeNestedCount(noteStatistics.trigrams, item.context, item.word, item.count);
		const rows = countStatisticsRows(noteStatistics);
		if (this.aggregate.acceptedSuggestions + this.aggregate.typedWords
			+ note.acceptedSuggestions + note.typedWords > PERSONAL_MODEL_LIMITS.maxAcceptedSuggestions
			|| this.trackedRows + rows > PERSONAL_MODEL_LIMITS.maxNoteStatisticRows) {
			throw new Error("Personal model exceeds configured data limits");
		}
		for (const [word, count] of noteStatistics.unigrams) {
			if (!this.aggregate.unigrams.has(word) && this.aggregate.unigrams.size >= PERSONAL_MODEL_LIMITS.maxWordTypes) {
				throw new Error("Personal model exceeds the word limit");
			}
			changeCount(this.aggregate.unigrams, word, count);
		}
		this.aggregateBigramTypes += mergeNestedWithLimit(this.aggregate.bigrams,
			noteStatistics.bigrams, PERSONAL_MODEL_LIMITS.maxBigramTypes);
		this.aggregateTrigramTypes += mergeNestedWithLimit(this.aggregate.trigrams,
			noteStatistics.trigrams, PERSONAL_MODEL_LIMITS.maxTrigramTypes);
		this.aggregate.acceptedSuggestions += note.acceptedSuggestions;
		this.aggregate.typedWords += note.typedWords;
		this.notes.set(note.path, noteStatistics);
		this.trackedRows += rows;
		for (const [word, count] of this.aggregate.unigrams) this.personalTrie.insert({ word, frequency: count });
	}

	private rebuildPersonalTrie(): void {
		this.personalTrie = new Trie();
		for (const [word, frequency] of this.aggregate.unigrams) this.personalTrie.insert({ word, frequency });
	}
}

function createStatistics(): MutableStatistics {
	return { acceptedSuggestions: 0, typedWords: 0, unigrams: new Map(), bigrams: new Map(), trigrams: new Map() };
}

function applyObservation(
	statistics: MutableStatistics,
	word: string,
	context: readonly string[],
	source: "accepted" | "typed",
): void {
	if (source === "accepted") statistics.acceptedSuggestions++;
	else statistics.typedWords++;
	changeCount(statistics.unigrams, word, 1);
	if (context.length >= 1) changeNestedCount(statistics.bigrams, context.slice(-1), word, 1);
	if (context.length >= 2) changeNestedCount(statistics.trigrams, context.slice(-2), word, 1);
}

function applyStatistics(target: MutableStatistics, source: MutableStatistics, direction: 1 | -1): void {
	target.acceptedSuggestions = Math.max(0, target.acceptedSuggestions + direction * source.acceptedSuggestions);
	target.typedWords = Math.max(0, target.typedWords + direction * source.typedWords);
	for (const [word, count] of source.unigrams) changeCount(target.unigrams, word, direction * count);
	applyNestedStatistics(target.bigrams, source.bigrams, direction);
	applyNestedStatistics(target.trigrams, source.trigrams, direction);
}

function mergeStatistics(target: MutableStatistics, source: MutableStatistics): void {
	target.acceptedSuggestions += source.acceptedSuggestions;
	target.typedWords += source.typedWords;
	for (const [word, count] of source.unigrams) changeCount(target.unigrams, word, count);
	applyNestedStatistics(target.bigrams, source.bigrams, 1);
	applyNestedStatistics(target.trigrams, source.trigrams, 1);
}

function applyNestedStatistics(
	target: Map<string, Map<string, number>>,
	source: Map<string, Map<string, number>>,
	direction: 1 | -1,
): void {
	for (const [contextKey, continuations] of source) {
		for (const [word, count] of continuations) {
			changeNestedCountByKey(target, contextKey, word, direction * count);
		}
	}
}

function changeNestedCount(
	counts: Map<string, Map<string, number>>,
	context: readonly string[],
	word: string,
	delta: number,
): void {
	changeNestedCountByKey(counts, contextKey(context), word, delta);
}

function changeNestedCountByKey(
	counts: Map<string, Map<string, number>>,
	key: string,
	word: string,
	delta: number,
): void {
	let continuations = counts.get(key);
	if (!continuations) {
		if (delta <= 0) return;
		continuations = new Map();
		counts.set(key, continuations);
	}
	changeCount(continuations, word, delta);
	if (continuations.size === 0) counts.delete(key);
}

function changeCount(counts: Map<string, number>, word: string, delta: number): void {
	const next = Math.max(0, (counts.get(word) ?? 0) + delta);
	if (next === 0) counts.delete(word);
	else counts.set(word, next);
}

function snapshotStatistics(statistics: MutableStatistics): PersonalModelStatistics {
	return {
		language: "en",
		acceptedSuggestions: statistics.acceptedSuggestions,
		typedWords: statistics.typedWords,
		unigrams: new Map(statistics.unigrams),
		bigrams: snapshotNGrams(statistics.bigrams, 1),
		trigrams: snapshotNGrams(statistics.trigrams, 2),
	};
}

function snapshotNGrams(
	counts: Map<string, Map<string, number>>,
	contextLength: 1 | 2,
): PersonalNGramCount[] {
	const result: PersonalNGramCount[] = [];
	for (const [key, continuations] of counts) {
		const context = parseContextKey(key, contextLength);
		for (const [word, count] of continuations) result.push({ context, word, count });
	}
	result.sort((left, right) => compareWords(left.context, right.context)
		|| left.word.localeCompare(right.word));
	return result;
}

function normalizeSingleEnglishWord(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const trimmed = value.trim();
	if (trimmed.length > 128) return undefined;
	const tokens = english.rules.tokenize(trimmed);
	if (tokens.length !== 1 || tokens[0].length !== trimmed.length) return undefined;
	const normalized = english.rules.normalizeWord(tokens[0]);
	return normalized || undefined;
}

function isValidPath(path: unknown): path is string {
	return typeof path === "string" && path.trim().length > 0 && path.length <= 1024 && !path.includes("\0");
}

function contextKey(context: readonly string[]): string {
	return JSON.stringify(context);
}

function parseContextKey(key: string, expectedLength: 1 | 2): string[] {
	const context: unknown = JSON.parse(key);
	if (!Array.isArray(context) || context.length !== expectedLength
		|| !context.every((word) => typeof word === "string")) {
		throw new Error("Personal model contains an invalid context key");
	}
	return context;
}

function compareWords(left: readonly string[], right: readonly string[]): number {
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const result = left[index].localeCompare(right[index]);
		if (result !== 0) return result;
	}
	return left.length - right.length;
}

function countNestedEntries(counts: Map<string, Map<string, number>>): number {
	let total = 0;
	for (const continuations of counts.values()) total += continuations.size;
	return total;
}

function countStatisticsRows(statistics: MutableStatistics): number {
	return statistics.unigrams.size + countNestedEntries(statistics.bigrams) + countNestedEntries(statistics.trigrams);
}

function countRemovableEntries(
	aggregate: Map<string, Map<string, number>>,
	note: Map<string, Map<string, number>>,
): number {
	let removable = 0;
	for (const [key, continuations] of note) {
		const aggregateContinuations = aggregate.get(key);
		for (const [word, count] of continuations) {
			if (aggregateContinuations?.get(word) === count) removable++;
		}
	}
	return removable;
}

function mergeNestedWithLimit(
	target: Map<string, Map<string, number>>,
	source: Map<string, Map<string, number>>,
	maximumEntries: number,
): number {
	let entryCount = countNestedEntries(target);
	let added = 0;
	for (const [key, continuations] of source) {
		for (const [word, count] of continuations) {
			if (!target.get(key)?.has(word)) {
				if (entryCount >= maximumEntries) throw new Error("Personal model exceeds the n-gram limit");
				entryCount++;
				added++;
			}
			changeNestedCountByKey(target, key, word, count);
		}
	}
	return added;
}

function parseSerializedNote(value: unknown): SerializedPersonalNote {
	if (!isRecord(value) || !isValidPath(value.path) || !isNonnegativeCount(value.acceptedSuggestions)
		|| !isNonnegativeCount(value.typedWords)
		|| !Array.isArray(value.unigrams) || !Array.isArray(value.bigrams) || !Array.isArray(value.trigrams)) {
		throw new Error("Malformed personal note statistics");
	}
	const unigrams: Array<[string, number]> = [];
	const seenWords = new Set<string>();
	let unigramTotal = 0;
	for (const row of value.unigrams) {
		if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || !isCount(row[1])
			|| normalizeSingleEnglishWord(row[0]) !== row[0] || seenWords.has(row[0])) {
			throw new Error("Malformed personal unigram statistics");
		}
		seenWords.add(row[0]);
		unigrams.push([row[0], row[1]]);
		unigramTotal += row[1];
	}
	if (unigramTotal !== value.acceptedSuggestions + value.typedWords) {
		throw new Error("Personal unigram total does not match observed word count");
	}
	const bigrams = parseNGramRows(value.bigrams, 1);
	const trigrams = parseNGramRows(value.trigrams, 2);
	if (bigrams.reduce((sum, row) => sum + row.count, 0) > unigramTotal
		|| trigrams.reduce((sum, row) => sum + row.count, 0) > unigramTotal) {
		throw new Error("Personal n-gram totals exceed accepted suggestions");
	}
	return { path: value.path, acceptedSuggestions: value.acceptedSuggestions, typedWords: value.typedWords,
		unigrams, bigrams, trigrams };
}

function parseNGramRows(value: unknown[], contextLength: 1 | 2): PersonalNGramCount[] {
	const result: PersonalNGramCount[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || !Array.isArray(item.context) || item.context.length !== contextLength
			|| !item.context.every((word) => typeof word === "string" && normalizeSingleEnglishWord(word) === word)
			|| typeof item.word !== "string" || normalizeSingleEnglishWord(item.word) !== item.word
			|| !isCount(item.count)) throw new Error("Malformed personal n-gram row");
		const key = `${contextKey(item.context as string[])}\0${item.word}`;
		if (seen.has(key)) throw new Error("Duplicate personal n-gram row");
		seen.add(key);
		result.push({ context: [...item.context] as string[], word: item.word, count: item.count });
	}
	return result;
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
