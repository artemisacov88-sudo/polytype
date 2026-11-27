import type { LanguageId } from "../language/types";
import { normalizeSpellingSurface } from "./normalization";
import { tokenizeSpellingText } from "./tokenizer";
import { boundedDamerauLevenshtein } from "./edit-distance";
import { LocalSpellingDictionary, SpellingDictionaryLoader } from "./dictionary-provider";
import type {
	SpellingCandidate,
	SpellingIssue,
	SpellingResult,
	SpellingSensitivity,
	SpellingSettings,
	SpellingWord,
} from "./spelling-types";

export interface ContextCandidateRanker {
	rank(language: LanguageId, context: readonly string[], candidates: readonly SpellingCandidate[]): Promise<readonly SpellingCandidate[]> | readonly SpellingCandidate[];
}

export interface PersonalSpellingDictionary {
	isAllowed(word: string, language: LanguageId): boolean;
	isIgnored(word: string, language: LanguageId): boolean;
	getRevision?(): number;
}

export interface SpellingEngineOptions {
	loader: SpellingDictionaryLoader;
	settings: () => SpellingSettings;
	personalDictionary?: PersonalSpellingDictionary;
	contextRanker?: ContextCandidateRanker;
}

export class SpellingEngine {
	private readonly dictionaryPromises = new Map<LanguageId, Promise<LocalSpellingDictionary>>();
	private readonly candidateCache = new Map<string, readonly SpellingCandidate[]>();
	private readonly candidateCacheOrder: string[] = [];
	private readonly maximumCacheEntries = 10_000;
	private readonly textCache = new Map<string, { text: string; result: SpellingResult }>();
	private readonly textCacheOrder: string[] = [];
	private readonly maximumTextCacheEntries = 32;

	constructor(private readonly options: SpellingEngineOptions) {}

	async checkText(
		text: string,
		languageHint: LanguageId,
		startOffset = 0,
	): Promise<SpellingResult> {
		const settings = this.options.settings();
		if (!settings.enabled) return { issues: [], checkedWordCount: 0 };
		const personalDictionaryRevision = this.options.personalDictionary?.getRevision?.() ?? 0;
		const textKey = `${languageHint}:${settings.sensitivity}:${settings.languages.join(",")}:${personalDictionaryRevision}:${startOffset}:${hashString(text)}`;
		const cachedText = this.textCache.get(textKey);
		if (cachedText?.text === text) return cachedText.result;
		const words = tokenizeSpellingText(text, { minimumLength: 1 });
		const issues: SpellingIssue[] = [];
		const batchIssueCache = new Map<string, SpellingIssue | null>();
		const recentContext: string[] = [];

		for (const relativeWord of words) {
			const word = {
				...relativeWord,
				from: startOffset + relativeWord.from,
				to: startOffset + relativeWord.to,
			};
			const language = resolveWordLanguage(word, languageHint, text, relativeWord.from);
			const resolved = language && settings.languages.includes(language)
				? { ...word, language }
				: undefined;
			if (!resolved) continue;
			recentContext.push(relativeWord.surfaceForm);
			if (recentContext.length > 3) recentContext.shift();
			const contextBeforeWord = recentContext.join(" ");
			const contextSignature = recentContext.join(" ");
			const batchKey = `${resolved.language}:${resolved.searchForm}:${settings.sensitivity}:${hashString(contextSignature)}`;
			let issue: SpellingIssue | null;
			if (batchIssueCache.has(batchKey)) {
				issue = batchIssueCache.get(batchKey) ?? null;
			} else {
				issue = (await this.checkWord(resolved, contextBeforeWord, settings)) ?? null;
				batchIssueCache.set(batchKey, issue);
			}
			if (issue) {
				issue = {
					...issue,
					word: resolved,
				};
			}
			if (issue) issues.push(issue);
		}
		const result = { issues, checkedWordCount: words.length };
		if (!this.textCache.has(textKey)) {
			this.textCacheOrder.push(textKey);
			if (this.textCacheOrder.length > this.maximumTextCacheEntries) {
				const oldest = this.textCacheOrder.shift();
				if (oldest) this.textCache.delete(oldest);
			}
		}
		this.textCache.set(textKey, { text, result });
		return result;
	}

	async checkWord(word: SpellingWord, contextText = "", settingsOverride?: SpellingSettings): Promise<SpellingIssue | undefined> {
		const settings = settingsOverride ?? this.options.settings();
		const language = word.language;
		if (!language || !settings.languages.includes(language)) return undefined;
		if (shouldProtectWord(word, language)) return undefined;

		const personal = this.options.personalDictionary;
		if (personal?.isAllowed(word.surfaceForm, language) || personal?.isIgnored(word.surfaceForm, language)) return undefined;
		if (language === "de") {
			let englishDictionary = this.dictionaryPromises.get("en");
			if (!englishDictionary) {
				englishDictionary = this.options.loader.load("en");
				this.dictionaryPromises.set("en", englishDictionary);
			}
			try {
				const english = await englishDictionary;
				if (english.has(word.searchForm)) return undefined;
			} catch {
				// Keep German checking as fallback.
			}
		}
		let dictionary = this.dictionaryPromises.get(language);
		if (!dictionary) {
			dictionary = this.options.loader.load(language);
			this.dictionaryPromises.set(language, dictionary);
		}
		let loaded: LocalSpellingDictionary;
		try {
			loaded = await dictionary;
		} catch (error) {
			console.error(`[PolyType] Spelling dictionary unavailable for ${language}`, error);
			return undefined;
		}

		if (loaded.has(word.searchForm)) return undefined;

		const maximumDistance = maximumDistanceForLength([...word.searchForm].length, settings.sensitivity);
		const cacheKey = `${language}:${settings.sensitivity}:${word.searchForm}`;
		let candidates = this.candidateCache.get(cacheKey);
		if (!candidates) {
			const generated: SpellingCandidate[] = [];
		for (const entry of loaded.candidates(word.searchForm, maximumDistance, [...word.searchForm].length <= 4 ? 100 : 30)) {
			let distance: number | null = null;
			for (const candidateForm of [entry.searchForm, ...entry.searchAliases]) {
				const value = boundedDamerauLevenshtein(word.searchForm, candidateForm, maximumDistance);
				if (value !== null && (distance === null || value < distance)) distance = value;
			}
			if (distance === null) continue;

			const lengthPenalty = Math.abs([...entry.searchForm].length - [...word.searchForm].length) * 0.04;
			const frequencyScale = Math.log1p(Math.max(0, entry.frequency));
			let confidence = Math.max(0, 1 - distance * 0.28 - lengthPenalty + Math.min(0.18, frequencyScale / 100));
			if (language === "en" && isAdjacentTransposition(word.searchForm, entry.searchForm)) confidence = Math.max(confidence, 0.90);
			if (language === "de" && entry.searchAliases.some((alias) => alias === word.searchForm)) confidence += 0.12;
			if (language === "ro" && entry.searchAliases.some((alias) => alias === word.searchForm)) confidence += 0.12;
			if (language === "ro") {
				const candidateAscii = entry.searchForm
					.replace(/[ăâ]/gu, "a").replace(/î/gu, "i")
					.replace(/[șş]/gu, "s").replace(/[țţ]/gu, "t");
				const wordAscii = word.searchForm
					.replace(/[ăâ]/gu, "a").replace(/î/gu, "i")
					.replace(/[șş]/gu, "s").replace(/[țţ]/gu, "t");
				if (candidateAscii === wordAscii) confidence = Math.max(confidence, 0.82);
			}
			generated.push({
				word: entry.surfaceForm,
				searchForm: entry.searchForm,
				distance,
				confidence,
			});
		}

		generated.sort((left, right) => right.confidence - left.confidence
			|| (right.distance ?? 99) - (left.distance ?? 99)
			|| left.word.localeCompare(right.word));
			candidates = generated.slice(0, 20);
			this.candidateCache.set(cacheKey, candidates);
			this.candidateCacheOrder.push(cacheKey);
			if (this.candidateCacheOrder.length > this.maximumCacheEntries) {
				const oldest = this.candidateCacheOrder.shift();
				if (oldest) this.candidateCache.delete(oldest);
			}
		}

		let ranked = candidates.slice(0, 5);
		if (ranked.length === 0) {
			return undefined;
		}
		const context = contextText
			? tokenizeSpellingText(contextText).map((item) => normalizeSpellingSurface(item.surfaceForm, language).searchForm).slice(-3)
			: [];
		if (this.options.contextRanker) {
			ranked = [...await this.options.contextRanker.rank(language, context, ranked)];
		}

		const confidenceFloor = settings.sensitivity === "highPrecision" ? 0.66
			: settings.sensitivity === "broad" ? 0.45 : 0.56;
		const best = ranked[0];
		if (!best || best.confidence < confidenceFloor) {
			return undefined;
		}

		if (settings.sensitivity === "highPrecision" && [...word.surfaceForm].length <= 4
			&& best.distance !== 1) {
			return undefined;
		}

		return { word, candidates: ranked, confidence: best.confidence };
	}
}

function hashString(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function tokenizeContextWords(text: string, wordOffset: number): readonly string[] {
	const before = text.slice(Math.max(0, wordOffset - 256), wordOffset);
	return before.toLocaleLowerCase().match(/[\p{L}]+/gu)?.slice(-8) ?? [];
}

function scoreLatinLanguageContext(words: readonly string[]): LanguageId | undefined {
	if (words.length === 0) return undefined;
	const scores: Record<"en" | "de" | "ro", number> = { en: 0, de: 0, ro: 0 };
	const enMarkers = new Set(["the","and","with","project","english","arbeit","and","in"]);
	const deMarkers = new Set(["ich","spreche","deutsch","und","arbeit","über","straße","guten","morgen"]);
	const roMarkers = new Set(["buna","bună","ziua","eu","lucrez","proiectul","și","tara","țară"]);
	for (const word of words) {
		if (enMarkers.has(word)) scores.en += 2;
		if (deMarkers.has(word)) scores.de += 2;
		if (roMarkers.has(word)) scores.ro += 2;
	}
	if (/[ăâîșț]/u.test(words.join(" "))) scores.ro += 4;
	if (/[äöüß]/u.test(words.join(" "))) scores.de += 4;
	const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]) as
		readonly (readonly [("en" | "de" | "ro"), number])[];
	const [best, second] = ranked;
	if (!best || best[1] < 2 || (second && best[1] === second[1])) return undefined;
	return best[0];
}

function isAdjacentTransposition(left: string, right: string): boolean {
	const a = [...left];
	const b = [...right];
	if (a.length !== b.length) return false;
	let differences = 0;
	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) differences++;
	}
	if (differences !== 2) return false;
	for (let index = 0; index < a.length - 1; index++) {
		if (a[index] === b[index + 1] && a[index + 1] === b[index]) return true;
	}
	return false;
}

function resolveWordLanguage(
	word: SpellingWord,
	languageHint: LanguageId,
	fullText: string,
	wordOffset: number,
): LanguageId | undefined {
	if (/[\u0400-\u04FF]/u.test(word.surfaceForm)) return "ru";
	if (/[ăâîșțşţ]/iu.test(word.surfaceForm)) return "ro";
	if (/[äöüß]/iu.test(word.surfaceForm)) return "de";
	const contextWords = tokenizeContextWords(fullText, wordOffset);
	const scored = scoreLatinLanguageContext(contextWords);
	if (scored) return scored;
	return languageHint;
}

function maximumDistanceForLength(length: number, sensitivity: SpellingSensitivity): number {
	if (length <= 4) return 1;
	if (length <= 12) return sensitivity === "broad" ? 2 : 1;
	return sensitivity === "broad" ? 3 : 2;
}

function shouldProtectWord(word: SpellingWord, language: LanguageId): boolean {
	const value = word.surfaceForm;
	if ([...value].length < 3) return true;
	if (/^[A-ZА-ЯЁ]{2,}$/u.test(value)) return true;
	if (/^\d+|[_/@]|^[\p{Lu}][\p{Ll}]*\p{Lu}/u.test(value)) return true;
	if (/[-_/.:]/u.test(value) && !/^[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)+$/u.test(value)) return true;
	if (language === "en" && /^[A-Z][a-z]+(?:[A-Z][a-z]*)+$/.test(value)) return true;
	if (/^(?:https?|www)\b/iu.test(value)) return true;
	return false;
}
