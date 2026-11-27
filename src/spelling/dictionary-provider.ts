import type { LanguageId } from "../language/types";
import { normalizeSpellingSurface } from "./normalization";
import type { SpellingDictionary, SpellingDictionaryEntry } from "./spelling-types";

export type SpellingDictionaryReader = (language: LanguageId) => Promise<unknown>;

interface RawDictionaryEntry {
	word: string;
	frequency: number;
	pos: string;
}

export class LocalSpellingDictionary implements SpellingDictionary {
	readonly entries: readonly SpellingDictionaryEntry[];
	private readonly exact = new Map<string, SpellingDictionaryEntry>();
	private readonly byLength = new Map<number, readonly SpellingDictionaryEntry[]>();
	private readonly signatures = new Map<string, readonly SpellingDictionaryEntry[]>();

	constructor(readonly language: LanguageId, rawEntries: readonly RawDictionaryEntry[]) {
		const normalized: SpellingDictionaryEntry[] = [];
		for (const entry of rawEntries) {
			const surfaceForm = entry.word;
			const normalizedWord = normalizeSpellingSurface(surfaceForm, language);
			const record: SpellingDictionaryEntry = {
				surfaceForm,
				searchForm: normalizedWord.searchForm,
				searchAliases: normalizedWord.searchAliases,
				frequency: entry.frequency,
				pos: entry.pos,
			};
			normalized.push(record);
			this.exact.set(record.searchForm, record);
			for (const alias of record.searchAliases) {
				if (alias === record.searchForm) continue;
				if (alias === normalizedWord.searchAliases[0]) continue;
			}
		}
		this.entries = normalized;

		const buckets = new Map<number, SpellingDictionaryEntry[]>();
		for (const entry of normalized) {
			const length = [...entry.searchForm].length;
			const bucket = buckets.get(length);
			if (bucket) bucket.push(entry);
			else buckets.set(length, [entry]);
		}
		for (const [length, entries] of buckets) {
			entries.sort((left, right) => right.frequency - left.frequency
				|| left.surfaceForm.localeCompare(right.surfaceForm));
			this.byLength.set(length, entries);
		}

		const signatureBuckets = new Map<string, SpellingDictionaryEntry[]>();
		for (const entry of normalized) {
			for (const signature of characterSignatures(entry.searchForm)) {
				const bucket = signatureBuckets.get(signature);
				if (bucket) bucket.push(entry);
				else signatureBuckets.set(signature, [entry]);
			}
		}
		for (const [signature, entries] of signatureBuckets) {
			this.signatures.set(signature, entries);
		}
	}

	has(searchForm: string): boolean {
		return this.exact.has(searchForm);
	}

	get(searchForm: string): SpellingDictionaryEntry | undefined {
		return this.exact.get(searchForm);
	}

	candidates(searchForm: string, maximumDistance: number, limit = 20): readonly SpellingDictionaryEntry[] {
		const length = [...searchForm].length;
		const result = new Map<string, { entry: SpellingDictionaryEntry; score: number }>();
		const forms = new Set([searchForm]);
		if (this.language === "ro") {
			for (const candidateForm of [...forms]) {
				if (candidateForm.includes("t")) forms.add(candidateForm.replace(/t/g, "ț"));
				if (candidateForm.includes("s")) forms.add(candidateForm.replace(/s/g, "ș"));
			}
		}
		if (this.language === "de") {
			for (const candidateForm of [...forms]) {
				if (candidateForm.includes("ss")) forms.add(candidateForm.replace(/ss/g, "ß"));
			}
		}
		for (const form of forms) for (const signature of characterSignatures(form)) {
			for (const entry of this.signatures.get(signature) ?? []) {
				const entryLength = [...entry.searchForm].length;
				if (Math.abs(entryLength - length) > maximumDistance) continue;
				const current = result.get(entry.searchForm);
				result.set(entry.searchForm, {
					entry,
					score: (current?.score ?? 0) + 1,
				});
			}
		}
		for (let candidateLength = Math.max(1, length - maximumDistance);
			candidateLength <= length + maximumDistance; candidateLength++) {
			const entries = this.byLength.get(candidateLength);
			if (!entries) continue;
			for (const entry of entries) {
				const current = result.get(entry.searchForm);
				if (!current) result.set(entry.searchForm, { entry, score: 0 });
			}
		}
		return [...result.values()]
			.sort((left, right) => right.score - left.score
				|| right.entry.frequency - left.entry.frequency
				|| left.entry.surfaceForm.localeCompare(right.entry.surfaceForm))
			.slice(0, limit)
			.map(({ entry }) => entry);
	}
}

function characterSignatures(word: string): readonly string[] {
	const chars = [...word];
	const signatures = new Set<string>();
	for (let index = 0; index < chars.length - 1; index++) {
		signatures.add(`${chars[index]}${chars[index + 1]}`);
	}
	for (let index = 0; index < chars.length; index++) {
		signatures.add(`${chars.slice(0, index).join("")}|${chars.slice(index + 1).join("")}`);
	}
	return [...signatures];
}

export class SpellingDictionaryLoader {
	private readonly cache = new Map<LanguageId, Promise<LocalSpellingDictionary>>();

	constructor(private readonly read: SpellingDictionaryReader) {}

	load(language: LanguageId): Promise<LocalSpellingDictionary> {
		let pending = this.cache.get(language);
		if (!pending) {
			pending = this.read(language).then((value) => {
				if (!Array.isArray(value)) throw new Error(`Invalid ${language} spelling dictionary`);
				const entries = value.filter(isRawDictionaryEntry);
				if (entries.length === 0) throw new Error(`Empty ${language} spelling dictionary`);
				return new LocalSpellingDictionary(language, entries);
			}).catch((error: unknown) => {
				this.cache.delete(language);
				throw error;
			});
			this.cache.set(language, pending);
		}
		return pending;
	}
}

export function createBundledSpellingDictionaryReader(
	readText: (path: string) => Promise<string>,
	pluginDirectory: string,
): SpellingDictionaryReader {
	return async (language) => {
		const path = language === "en"
			? `${pluginDirectory}/data/english-words.json`
			: `${pluginDirectory}/data/multilingual/${language}/words.json`;
		return JSON.parse(await readText(path)) as unknown;
	};
}

function isRawDictionaryEntry(value: unknown): value is RawDictionaryEntry {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.word === "string"
		&& typeof record.frequency === "number"
		&& typeof record.pos === "string";
}
