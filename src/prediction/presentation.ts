import type { LanguageId } from "../language/types";

/** Apply editor casing after prediction and language-normalized lookup finish. */
export function presentSuggestion(
	suggestion: string,
	textBeforeCursor: string,
	query: string,
	language: LanguageId,
): string {
	if (!suggestion) return suggestion;
	const locale = language === "en" ? "en-US" : language === "de" ? "de-DE" : language === "ro" ? "ro-RO" : "ru-RU";
	const capitalize = /^\p{Lu}/u.test(query)
		|| /(?:^|[.!?])\s*$|\n\s*$/u.test(textBeforeCursor);
	if (!capitalize) return suggestion;
	const first = Array.from(suggestion)[0];
	return first.toLocaleUpperCase(locale) + suggestion.slice(first.length);
}
