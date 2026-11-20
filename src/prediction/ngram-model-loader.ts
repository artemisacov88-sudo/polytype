export const OANC_NGRAM_FORMAT_VERSION = 1;
export const OANC_NGRAM_BINARY_MAGIC = "PTNG";

export interface NGramModelManifest {
	format_version: number;
	corpus: string;
	configuration: string;
	min_count: number;
	max_successors_per_context: number | null;
	vocabulary_count: number;
	record_counts: Record<"1" | "2" | "3" | "4", number>;
	binary_bytes: number;
	binary_sha256: string;
	context_statistics_file?: string;
	context_statistics_version?: number;
	context_statistics_context_counts?: Record<"1" | "2" | "3", number>;
	context_statistics_bytes?: number;
	context_statistics_sha256?: string;
}

export interface NGramContinuation {
	word: string;
	frequency: number;
	/** Sum of frequencies retained for this context in this pruned export. */
	contextFrequency: number;
	contextLength: number;
}

export interface NGramLookupResult {
	contextFrequency: number;
	continuations: NGramContinuation[];
}

export type NGramBinaryReader = (path: string) => Promise<ArrayBuffer>;
export type NGramManifestReader = (path: string) => Promise<string>;
export type NGramContextStatisticsReader = (path: string) => Promise<ArrayBuffer>;
export type NGramSha256 = (bytes: ArrayBuffer) => Promise<string>;

export const DEFAULT_OANC_NGRAM_BINARY_PATH = "data/experiments/moderate/binary/model.ptng";
export const DEFAULT_OANC_NGRAM_MANIFEST_PATH = "data/experiments/moderate/manifest.json";
export const DEFAULT_OANC_NGRAM_CONTEXT_STATS_PATH = "data/experiments/moderate/binary/context-stats.ptgs";

const HEADER_SIZE = 44;
const MAX_LOOKUP_LIMIT = 100;
const CONTEXT_STATS_MAGIC = "PTGS";
const CONTEXT_STATS_VERSION = 1;
const CONTEXT_STATS_HEADER_SIZE = 24;

/** Indexed view over full train-only unigram and context statistics. */
export class OancNGramContextStatistics {
	private readonly view: DataView;
	private readonly sectionOffsets: number[] = [];
	private readonly recordSizes = [12, 16, 20];
	readonly unigramTotal: number;
	readonly maximumUnigramFrequency: number;

	constructor(bytes: ArrayBuffer, vocabularySize: number, private readonly recordCounts: number[]) {
		this.view = new DataView(bytes);
	let total = 0;
	let maximum = 0;
	for (let id = 0; id < vocabularySize; id++) {
		const count = this.view.getUint32(CONTEXT_STATS_HEADER_SIZE + id * 4, true);
		total += count;
		maximum = Math.max(maximum, count);
	}
	this.unigramTotal = total;
	this.maximumUnigramFrequency = maximum;
		let offset = CONTEXT_STATS_HEADER_SIZE + vocabularySize * 4;
		for (let index = 0; index < 3; index++) {
			this.sectionOffsets.push(offset);
			offset += this.recordSizes[index] * recordCounts[index];
		}
	}

	getUnigramFrequency(wordId: number): number {
		return this.view.getUint32(CONTEXT_STATS_HEADER_SIZE + wordId * 4, true);
	}

	lookup(context: readonly number[]): { total: number; continuationTypes: number } | undefined {
		if (context.length < 1 || context.length > 3) return undefined;
		const section = context.length - 1;
		let low = 0;
		let high = this.recordCounts[section];
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (this.compare(middle, context, section) < 0) low = middle + 1;
			else high = middle;
		}
		if (low >= this.recordCounts[section] || this.compare(low, context, section) !== 0) return undefined;
		const at = this.sectionOffsets[section] + low * this.recordSizes[section] + context.length * 4;
		return { total: this.view.getUint32(at, true), continuationTypes: this.view.getUint32(at + 4, true) };
	}

	private compare(recordIndex: number, context: readonly number[], section: number): number {
		const at = this.sectionOffsets[section] + recordIndex * this.recordSizes[section];
		for (let index = 0; index < context.length; index++) {
			const id = this.view.getUint32(at + index * 4, true);
			if (id < context[index]) return -1;
			if (id > context[index]) return 1;
		}
		return 0;
	}
}

export class NGramModelLoadError extends Error {
	constructor(message: string) {
		super(`[PolyType] ${message}`);
		this.name = "NGramModelLoadError";
	}
}

/**
 * A zero-copy reader for the exported PTNG v1 format. The ArrayBuffer returned
 * by the Vault Adapter is retained; DataView and byte slices are views over it.
 */
export class OancBinaryNGramModel {
	readonly vocabularySize: number;
	readonly recordCounts: readonly number[];

	private readonly view: DataView;
	private readonly vocabulary: string[];
	private readonly wordIds: Map<string, number>;
	private readonly wordFrequencies: Uint32Array;
	private readonly retainedUnigramTotal: number;
	private readonly sectionOffsets: number[];
	private readonly sectionRecordSizes: number[];
	private contextStatistics: OancNGramContextStatistics | undefined;

	constructor(
		bytes: ArrayBuffer,
		vocabulary: string[],
		wordIds: Map<string, number>,
		wordFrequencies: Uint32Array,
		sectionOffsets: number[],
		sectionRecordSizes: number[],
		recordCounts: number[],
	) {
		this.view = new DataView(bytes);
		this.vocabulary = vocabulary;
		this.wordIds = wordIds;
		this.wordFrequencies = wordFrequencies;
	this.retainedUnigramTotal = wordFrequencies.reduce((sum, count) => sum + count, 0);
		this.sectionOffsets = sectionOffsets;
		this.sectionRecordSizes = sectionRecordSizes;
		this.recordCounts = recordCounts;
		this.vocabularySize = vocabulary.length;
	}

	get maxWordFrequency(): number {
		return this.contextStatistics?.maximumUnigramFrequency
			?? this.wordFrequencies.reduce((max, count) => Math.max(max, count), 0);
	}

	get totalUnigramFrequency(): number {
		return this.contextStatistics?.unigramTotal
			?? this.wordFrequencies.reduce((sum, count) => sum + count, 0);
	}

	getWordFrequency(word: string): number {
		const id = this.wordIds.get(normalizeEnglish(word));
		return id === undefined ? 0 : this.contextStatistics?.getUnigramFrequency(id) ?? this.wordFrequencies[id];
	}

	getWordId(word: string): number | undefined {
		return this.wordIds.get(normalizeEnglish(word));
	}

	getWordProbability(word: string): number {
		return this.totalUnigramFrequency > 0 ? this.getWordFrequency(word) / this.totalUnigramFrequency : 0;
	}

	attachContextStatistics(statistics: OancNGramContextStatistics): void {
		this.contextStatistics = statistics;
	}

	getContextStatistics(contextWords: readonly string[]): { total: number; continuationTypes: number } | undefined {
		if (!this.contextStatistics) return undefined;
		const ids = this.resolveContext(contextWords);
		return ids ? this.contextStatistics.lookup(ids) : undefined;
	}

	getRetainedContinuations(contextWords: readonly string[]): NGramContinuation[] {
		const context = this.resolveContext(contextWords);
		if (!context || context.length === 0) return [];
		const order = context.length + 1;
		const orderIndex = order - 1;
		const result: NGramContinuation[] = [];
		const first = this.lowerBound(order, context);
		for (let index = first; index < this.recordCounts[orderIndex]; index++) {
			if (this.compareRecordContext(order, index, context) !== 0) break;
			const at = this.sectionOffsets[orderIndex] + index * this.sectionRecordSizes[orderIndex];
			const wordId = this.view.getUint32(at + 1 + (order - 1) * 4, true);
			const frequency = this.view.getUint32(at + 1 + order * 4, true);
			result.push({ word: this.vocabulary[wordId], frequency, contextFrequency: 0, contextLength: context.length });
		}
		return result;
	}

	hasWord(word: string): boolean {
		return this.wordIds.has(normalizeEnglish(word));
	}

	hasContext(contextWords: readonly string[]): boolean {
		const context = this.resolveContext(contextWords);
		if (!context) return false;
		if (context.length === 0) return this.recordCounts[0] > 0;
		const order = context.length + 1;
		const first = this.lowerBound(order, context);
		return first < this.recordCounts[order - 1] && this.compareRecordContext(order, first, context) === 0;
	}

	/** Sum of stored successor counts. For a pruned model this is a retained-count total. */
	getContextFrequency(contextWords: readonly string[]): number {
		return this.lookup(contextWords, "", MAX_LOOKUP_LIMIT).contextFrequency;
	}

	lookupContinuations(
		contextWords: readonly string[],
		prefix: string,
		limit = 5,
	): NGramLookupResult {
		const safeLimit = normalizeLimit(limit);
		if (safeLimit === 0) return { contextFrequency: 0, continuations: [] };
		return this.lookup(contextWords, normalizeEnglish(prefix), safeLimit);
	}

	/** Full train unigram candidates, including types omitted by PTNG pruning. */
	lookupFullUnigrams(prefix: string, limit = 5): NGramLookupResult {
		return this.lookupUnigrams(normalizeEnglish(prefix), normalizeLimit(limit), true);
	}

	private lookup(
		contextWords: readonly string[],
		prefix: string,
		limit: number,
	): NGramLookupResult {
		const context = this.resolveContext(contextWords);
		if (!context) return { contextFrequency: 0, continuations: [] };
		if (context.length === 0) return this.lookupUnigrams(prefix, limit);

		const order = context.length + 1;
		const orderIndex = order - 1;
		const recordCount = this.recordCounts[orderIndex];
		const first = this.lowerBound(order, context);
		const continuations: NGramContinuation[] = [];
		let contextFrequency = 0;
		for (let index = first; index < recordCount; index++) {
			if (this.compareRecordContext(order, index, context) !== 0) break;
			const at = this.sectionOffsets[orderIndex] + index * this.sectionRecordSizes[orderIndex];
			const wordId = this.view.getUint32(at + 1 + (order - 1) * 4, true);
			const frequency = this.view.getUint32(at + 1 + order * 4, true);
			contextFrequency += frequency;
			const word = this.vocabulary[wordId];
			if (word.startsWith(prefix) && continuations.length < limit) {
				continuations.push({ word, frequency, contextFrequency: 0, contextLength: context.length });
			}
		}
		for (const item of continuations) item.contextFrequency = contextFrequency;
		return { contextFrequency, continuations };
	}

	private lookupUnigrams(prefix: string, limit: number, useFullStatistics = false): NGramLookupResult {
		const start = lowerBoundWord(this.vocabulary, prefix);
		const continuations: NGramContinuation[] = [];
		const contextFrequency = useFullStatistics
			? this.totalUnigramFrequency
			: this.retainedUnigramTotal;
		for (let id = start; id < this.vocabulary.length; id++) {
			const word = this.vocabulary[id];
			if (!word.startsWith(prefix)) break;
			const frequency = useFullStatistics
				? this.contextStatistics?.getUnigramFrequency(id) ?? this.wordFrequencies[id]
				: this.wordFrequencies[id];
			if (frequency > 0) {
				insertTopFrequency(continuations, { word, frequency, contextFrequency: 0, contextLength: 0 }, limit);
			}
		}
		for (const item of continuations) item.contextFrequency = contextFrequency;
		return { contextFrequency, continuations };
	}

	private resolveContext(contextWords: readonly string[]): number[] | null {
		const words = contextWords.slice(-3);
		const ids: number[] = [];
		for (const word of words) {
			const id = this.wordIds.get(normalizeEnglish(word));
			if (id === undefined) return null;
			ids.push(id);
		}
		return ids;
	}

	private lowerBound(order: number, context: readonly number[]): number {
		const orderIndex = order - 1;
		let low = 0;
		let high = this.recordCounts[orderIndex];
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (this.compareRecordContext(order, middle, context) < 0) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	private compareRecordContext(order: number, recordIndex: number, context: readonly number[]): number {
		const at = this.sectionOffsets[order - 1] + recordIndex * this.sectionRecordSizes[order - 1] + 1;
		for (let index = 0; index < context.length; index++) {
			const id = this.view.getUint32(at + index * 4, true);
			if (id < context[index]) return -1;
			if (id > context[index]) return 1;
		}
		return 0;
	}
}

/** Lazy, deduplicated local loader. A rejected read is cleared so later calls retry. */
export class NGramModelLoader {
	private pending: Promise<OancBinaryNGramModel> | undefined;

	constructor(
		private readonly readBinary: NGramBinaryReader,
		private readonly readManifest: NGramManifestReader,
		private readonly binaryPath = DEFAULT_OANC_NGRAM_BINARY_PATH,
		private readonly manifestPath = DEFAULT_OANC_NGRAM_MANIFEST_PATH,
		private readonly digest: NGramSha256 = sha256,
		private readonly readContextStatistics?: NGramContextStatisticsReader,
	) {}

	load(): Promise<OancBinaryNGramModel> {
		if (!this.pending) {
			const pending = this.loadOnce();
			this.pending = pending;
			void pending.catch(() => {
				if (this.pending === pending) this.pending = undefined;
			});
		}
		return this.pending;
	}

	private async loadOnce(): Promise<OancBinaryNGramModel> {
		let bytes: ArrayBuffer;
		let manifestText: string;
		try {
			[bytes, manifestText] = await Promise.all([
				this.readBinary(this.binaryPath),
				this.readManifest(this.manifestPath),
			]);
		} catch (error) {
			throw new NGramModelLoadError(`Could not read the local OANC binary model or manifest: ${describe(error)}`);
		}
		const manifest = parseManifest(manifestText);
		if (bytes.byteLength !== manifest.binary_bytes) {
			throw new NGramModelLoadError(`Binary model size mismatch: expected ${manifest.binary_bytes}, received ${bytes.byteLength}`);
		}
		const actualHash = await this.digest(bytes);
		if (actualHash.toLowerCase() !== manifest.binary_sha256.toLowerCase()) {
			throw new NGramModelLoadError("Binary model SHA-256 does not match its manifest");
		}
		const model = parseBinaryModel(bytes, manifest);
		if (manifest.context_statistics_file) {
			if (!this.readContextStatistics) throw new NGramModelLoadError("Context statistics are required but no local reader was provided");
			const base = this.manifestPath.slice(0, this.manifestPath.lastIndexOf("/") + 1);
			const statsPath = `${base}${manifest.context_statistics_file}`;
			let statisticsBytes: ArrayBuffer;
			try {
				statisticsBytes = await this.readContextStatistics(statsPath);
			} catch (error) {
				throw new NGramModelLoadError(`Could not read full context statistics: ${describe(error)}`);
			}
			if (statisticsBytes.byteLength !== manifest.context_statistics_bytes) {
				throw new NGramModelLoadError("Context statistics size does not match its manifest");
			}
			const statisticsHash = await this.digest(statisticsBytes);
			if (statisticsHash.toLowerCase() !== manifest.context_statistics_sha256?.toLowerCase()) {
				throw new NGramModelLoadError("Context statistics SHA-256 does not match its manifest");
			}
			model.attachContextStatistics(parseContextStatistics(statisticsBytes, manifest));
		}
		return model;
	}
}

export function parseManifest(text: string): NGramModelManifest {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new NGramModelLoadError(`Could not parse the binary model manifest: ${describe(error)}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new NGramModelLoadError("Binary model manifest must be an object");
	}
	const manifest = value as Partial<NGramModelManifest>;
	if (manifest.format_version !== OANC_NGRAM_FORMAT_VERSION) {
		throw new NGramModelLoadError(`Unsupported binary model format version: ${String(manifest.format_version)}`);
	}
	if (typeof manifest.corpus !== "string" || typeof manifest.configuration !== "string"
		|| typeof manifest.vocabulary_count !== "number" || !Number.isSafeInteger(manifest.vocabulary_count)
		|| manifest.vocabulary_count < 1 || typeof manifest.binary_bytes !== "number"
		|| !Number.isSafeInteger(manifest.binary_bytes) || manifest.binary_bytes < HEADER_SIZE
		|| typeof manifest.binary_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.binary_sha256)
		|| (manifest.max_successors_per_context !== null
			&& (typeof manifest.max_successors_per_context !== "number"
				|| !Number.isSafeInteger(manifest.max_successors_per_context)
				|| manifest.max_successors_per_context < 1))) {
		throw new NGramModelLoadError("Binary model manifest has invalid or missing metadata");
	}
	const recordCounts = manifest.record_counts;
	if (!recordCounts || ![recordCounts["1"], recordCounts["2"], recordCounts["3"], recordCounts["4"]]
		.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
		throw new NGramModelLoadError("Binary model manifest has invalid per-order record counts");
	}
	if (manifest.context_statistics_file !== undefined) {
		const counts = manifest.context_statistics_context_counts;
		if (typeof manifest.context_statistics_file !== "string"
			|| !/^binary\/[A-Za-z0-9_.-]+\.ptgs$/.test(manifest.context_statistics_file)
			|| manifest.context_statistics_version !== CONTEXT_STATS_VERSION
			|| typeof manifest.context_statistics_bytes !== "number" || !Number.isSafeInteger(manifest.context_statistics_bytes)
			|| manifest.context_statistics_bytes < CONTEXT_STATS_HEADER_SIZE + manifest.vocabulary_count * 4
			|| typeof manifest.context_statistics_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.context_statistics_sha256)
			|| !counts || ![counts["1"], counts["2"], counts["3"]]
				.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
			throw new NGramModelLoadError("Manifest has invalid full context statistics metadata");
		}
	}
	return manifest as NGramModelManifest;
}

export function parseContextStatistics(bytes: ArrayBuffer, manifest: NGramModelManifest): OancNGramContextStatistics {
	if (bytes.byteLength < CONTEXT_STATS_HEADER_SIZE) throw new NGramModelLoadError("Context statistics file is shorter than its header");
	const view = new DataView(bytes);
	for (let index = 0; index < CONTEXT_STATS_MAGIC.length; index++) {
		if (view.getUint8(index) !== CONTEXT_STATS_MAGIC.charCodeAt(index)) {
			throw new NGramModelLoadError("Context statistics have an invalid PTGS magic header");
		}
	}
	if (view.getUint32(4, true) !== CONTEXT_STATS_VERSION) {
		throw new NGramModelLoadError(`Unsupported context statistics version: ${view.getUint32(4, true)}`);
	}
	const vocabularyCount = view.getUint32(8, true);
	if (vocabularyCount !== manifest.vocabulary_count) throw new NGramModelLoadError("Context statistics vocabulary size mismatch");
	const recordCounts = [view.getUint32(12, true), view.getUint32(16, true), view.getUint32(20, true)];
	const expected = manifest.context_statistics_context_counts!;
	for (let index = 0; index < 3; index++) {
		if (recordCounts[index] !== expected[String(index + 1) as "1" | "2" | "3"]) {
			throw new NGramModelLoadError("Context statistics section counts do not match the manifest");
		}
	}
	let expectedBytes = CONTEXT_STATS_HEADER_SIZE + vocabularyCount * 4;
	for (let index = 0; index < 3; index++) expectedBytes += recordCounts[index] * [12, 16, 20][index];
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== bytes.byteLength) {
		throw new NGramModelLoadError("Context statistics contain truncated or trailing data");
	}
	let offset = CONTEXT_STATS_HEADER_SIZE;
	for (let id = 0; id < vocabularyCount; id++, offset += 4) {
		if (view.getUint32(offset, true) === 0) throw new NGramModelLoadError("Full unigram statistics contain a zero-frequency vocabulary word");
	}
	const sizes = [12, 16, 20];
	for (let section = 0; section < 3; section++) {
		let previous: number[] | undefined;
		const start = CONTEXT_STATS_HEADER_SIZE + vocabularyCount * 4
			+ recordCounts.slice(0, section).reduce((sum, count, index) => sum + count * sizes[index], 0);
		for (let index = 0; index < recordCounts[section]; index++) {
			const at = start + index * sizes[section];
			const context: number[] = [];
			for (let part = 0; part <= section; part++) {
				const id = view.getUint32(at + part * 4, true);
				if (id >= vocabularyCount) throw new NGramModelLoadError("Context statistics word ID is outside the vocabulary");
				context.push(id);
			}
			if (previous && compareIds(previous, context) >= 0) throw new NGramModelLoadError("Context statistics are not uniquely sorted");
			const total = view.getUint32(at + context.length * 4, true);
			const types = view.getUint32(at + context.length * 4 + 4, true);
			if (total === 0 || types === 0 || types > total) {
				throw new NGramModelLoadError("Context statistics contain impossible totals or continuation counts");
			}
			previous = context;
		}
	}
	return new OancNGramContextStatistics(bytes, vocabularyCount, recordCounts);
}

export function parseBinaryModel(bytes: ArrayBuffer, manifest: NGramModelManifest): OancBinaryNGramModel {
	if (bytes.byteLength < HEADER_SIZE) throw new NGramModelLoadError("Binary model is shorter than its header");
	const view = new DataView(bytes);
	for (let index = 0; index < OANC_NGRAM_BINARY_MAGIC.length; index++) {
		if (view.getUint8(index) !== OANC_NGRAM_BINARY_MAGIC.charCodeAt(index)) {
			throw new NGramModelLoadError("Binary model has an invalid PTNG magic header");
		}
	}
	const version = view.getUint32(4, true);
	if (version !== OANC_NGRAM_FORMAT_VERSION) throw new NGramModelLoadError(`Unsupported binary model format version: ${version}`);
	const vocabularyCount = view.getUint32(8, true);
	if (vocabularyCount !== manifest.vocabulary_count) throw new NGramModelLoadError("Binary vocabulary count does not match its manifest");
	const recordCounts: number[] = [];
	for (let order = 0; order < 4; order++) {
		const offset = 12 + order * 8;
		const count = view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x1_0000_0000;
		if (!Number.isSafeInteger(count) || count !== manifest.record_counts[String(order + 1) as "1" | "2" | "3" | "4"]) {
			throw new NGramModelLoadError(`Binary ${order + 1}-gram count does not match its manifest`);
		}
		recordCounts.push(count);
	}

	let offset = HEADER_SIZE;
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const vocabulary: string[] = [];
	const wordIds = new Map<string, number>();
	let previousWord = "";
	for (let id = 0; id < vocabularyCount; id++) {
		if (offset + 2 > bytes.byteLength) throw new NGramModelLoadError("Truncated binary vocabulary length");
		const byteLength = view.getUint16(offset, true);
		offset += 2;
		if (offset + byteLength > bytes.byteLength) throw new NGramModelLoadError("Truncated binary vocabulary entry");
		let word: string;
		try {
			word = decoder.decode(new Uint8Array(bytes, offset, byteLength));
		} catch (error) {
			throw new NGramModelLoadError(`Invalid UTF-8 vocabulary entry: ${describe(error)}`);
		}
		offset += byteLength;
		if (!word || word !== normalizeEnglish(word) || wordIds.has(word) || (id > 0 && word <= previousWord)) {
			throw new NGramModelLoadError("Binary vocabulary is not unique, lowercase, and lexically sorted");
		}
		vocabulary.push(word);
		wordIds.set(word, id);
		previousWord = word;
	}

	const sectionOffsets: number[] = [];
	const sectionRecordSizes: number[] = [];
	for (let order = 1; order <= 4; order++) {
		const recordSize = 1 + (order + 1) * 4;
		const byteLength = recordCounts[order - 1] * recordSize;
		if (!Number.isSafeInteger(byteLength) || offset + byteLength > bytes.byteLength) {
			throw new NGramModelLoadError(`Truncated ${order}-gram records`);
		}
		sectionOffsets.push(offset);
		sectionRecordSizes.push(recordSize);
		offset += byteLength;
	}
	if (offset !== bytes.byteLength) throw new NGramModelLoadError("Binary model contains unexpected trailing data");

	const wordFrequencies = new Uint32Array(vocabularyCount);
	for (let order = 1; order <= 4; order++) {
		validateOrderRecords(view, order, sectionOffsets[order - 1], sectionRecordSizes[order - 1],
			recordCounts[order - 1], vocabularyCount, manifest.max_successors_per_context);
		if (order === 1) {
			for (let index = 0; index < recordCounts[0]; index++) {
				const at = sectionOffsets[0] + index * sectionRecordSizes[0];
				const wordId = view.getUint32(at + 1, true);
				wordFrequencies[wordId] = view.getUint32(at + 5, true);
			}
		}
	}
	return new OancBinaryNGramModel(bytes, vocabulary, wordIds, wordFrequencies,
		sectionOffsets, sectionRecordSizes, recordCounts);
}

function validateOrderRecords(
	view: DataView,
	order: number,
	sectionOffset: number,
	recordSize: number,
	recordCount: number,
	vocabularyCount: number,
	maxSuccessors: number | null,
): void {
	let previousContext: number[] | undefined;
	let previousCount = Number.MAX_SAFE_INTEGER;
	let previousWordId = -1;
	let successorsInContext = 0;
	let previousWordIds = new Set<number>();
	for (let index = 0; index < recordCount; index++) {
		const at = sectionOffset + index * recordSize;
		if (view.getUint8(at) !== order) throw new NGramModelLoadError(`Unexpected order marker in ${order}-gram section`);
		const context: number[] = [];
		for (let position = 0; position < order - 1; position++) {
			const wordId = view.getUint32(at + 1 + position * 4, true);
			if (wordId >= vocabularyCount) throw new NGramModelLoadError("Context word ID is outside the vocabulary");
			context.push(wordId);
		}
		const nextWordId = view.getUint32(at + 1 + (order - 1) * 4, true);
		const frequency = view.getUint32(at + 1 + order * 4, true);
		if (nextWordId >= vocabularyCount || frequency === 0) throw new NGramModelLoadError("Invalid continuation ID or zero frequency");
		const sameContext = previousContext !== undefined && compareIds(previousContext, context) === 0;
		if (previousContext && !sameContext && compareIds(previousContext, context) > 0) {
			throw new NGramModelLoadError(`${order}-gram contexts are not sorted for indexed lookup`);
		}
		if (!sameContext) {
			previousContext = context;
			previousCount = Number.MAX_SAFE_INTEGER;
			previousWordId = -1;
			successorsInContext = 0;
			previousWordIds = new Set<number>();
		}
		if (frequency > previousCount || (frequency === previousCount && nextWordId < previousWordId)) {
			throw new NGramModelLoadError(`${order}-gram continuations are not sorted by frequency and word ID`);
		}
		if (previousWordIds.has(nextWordId)) throw new NGramModelLoadError(`Duplicate continuation in ${order}-gram context`);
		previousWordIds.add(nextWordId);
		previousCount = frequency;
		previousWordId = nextWordId;
		successorsInContext++;
		if (order > 1 && maxSuccessors !== null && successorsInContext > maxSuccessors) {
			throw new NGramModelLoadError(`${order}-gram context exceeds the manifest successor limit`);
		}
	}
}

function compareIds(left: readonly number[], right: readonly number[]): number {
	for (let index = 0; index < left.length; index++) {
		if (left[index] < right[index]) return -1;
		if (left[index] > right[index]) return 1;
	}
	return 0;
}

function lowerBoundWord(words: readonly string[], prefix: string): number {
	let low = 0;
	let high = words.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (words[middle] < prefix) low = middle + 1;
		else high = middle;
	}
	return low;
}

function insertTopFrequency(items: NGramContinuation[], candidate: NGramContinuation, limit: number): void {
	let at = 0;
	while (at < items.length && (items[at].frequency > candidate.frequency
		|| (items[at].frequency === candidate.frequency && items[at].word <= candidate.word))) at++;
	if (at >= limit) return;
	items.splice(at, 0, candidate);
	if (items.length > limit) items.pop();
}

function normalizeLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) return 0;
	return Math.min(MAX_LOOKUP_LIMIT, Math.floor(limit));
}

function normalizeEnglish(word: string): string {
	return word.toLocaleLowerCase("en-US");
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new NGramModelLoadError("Web Crypto SHA-256 is not available in this Obsidian runtime");
	const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
