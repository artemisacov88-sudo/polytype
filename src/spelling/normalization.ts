import type { LanguageId } from "../language/types";
import type { SpellingWord } from "./spelling-types";

export interface NormalizedSpellingWord {
	searchForm: string;
	searchAliases: readonly string[];
}

export function normalizeSpellingSurface(surfaceForm: string, language: LanguageId): NormalizedSpellingWord {
	const nfc = surfaceForm.normalize("NFC");
	const lower = language === "ru"
		? nfc.toLocaleLowerCase("ru-RU")
		: language === "de"
			? nfc.toLocaleLowerCase("de-DE")
			: language === "ro"
				? nfc.toLocaleLowerCase("ro-RO")
				: nfc.toLocaleLowerCase("en-US");

	switch (language) {
		case "ru":
			return {
				searchForm: lower.replace(/ё/g, "е"),
				searchAliases: deduplicate([lower.replace(/ё/g, "е"), lower]),
			};
		case "ro":
			return {
				searchForm: lower.replace(/ş/g, "ș").replace(/ţ/g, "ț"),
				searchAliases: deduplicate([
					lower.replace(/ş/g, "ș").replace(/ţ/g, "ț"),
					lower.replace(/ș/g, "ş").replace(/ț/g, "ţ"),
					lower.replace(/ă/g, "a").replace(/â/g, "a")
						.replace(/î/g, "i").replace(/ș/g, "s").replace(/ț/g, "t")
						.replace(/ş/g, "s").replace(/ţ/g, "t"),
				]),
			};
		case "de":
			return {
				searchForm: lower,
				searchAliases: deduplicate([
					lower,
					lower.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss"),
				]),
			};
		case "en":
			return {
				searchForm: canonicalizeApostrophes(lower),
				searchAliases: deduplicate([canonicalizeApostrophes(lower), lower]),
			};
	}
}

export function createSpellingWord(
	surfaceForm: string,
	from: number,
	to: number,
	language?: LanguageId,
): SpellingWord {
	const resolvedLanguage = language ?? inferSpellingLanguage(surfaceForm);
	const normalized = resolvedLanguage
		? normalizeSpellingSurface(surfaceForm, resolvedLanguage)
		: {
			searchForm: surfaceForm.normalize("NFC").toLocaleLowerCase(),
			searchAliases: [surfaceForm.normalize("NFC")],
		};
	return {
		surfaceForm,
		searchForm: normalized.searchForm,
		searchAliases: normalized.searchAliases,
		from,
		to,
		language: resolvedLanguage,
	};
}

export function inferSpellingLanguage(word: string): LanguageId | undefined {
	const normalized = word.normalize("NFC");
	if (/[\u0400-\u04FF]/u.test(normalized)) return "ru";
	if (/[ăâîșțşţ]/iu.test(normalized)) return "ro";
	if (/[äöüß]/iu.test(normalized)) return "de";
	if (/[a-z]/iu.test(normalized)) return "en";
	return undefined;
}

export function canonicalizeApostrophes(word: string): string {
	return word.replace(/['ʼ`]/gu, "’");
}

function deduplicate(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}
