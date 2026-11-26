import type { LanguageId } from "./types";

const LANGUAGE_MARKERS: Record<Exclude<LanguageId, "ru">, ReadonlySet<string>> = {
	en: new Set("the and this that with have you are for hello how would like thank thanks please from because what where your".split(" ")),
	de: new Set("der die das und ist nicht mit ein eine einen guten morgen tag wie geht dir ich du hallo danke grüße straße spreche deutsch aus".split(" ")),
	ro: new Set("și sunt este pentru care acest această din în bună ziua mulțumesc vorbesc despre țară bine ajutor".split(" ")),
};

const MINIMUM_CONFIDENCE = 4;
const MINIMUM_CONFIDENCE_MARGIN = 2;
const STRONG_ROMANIAN_MARKERS = new Set("și sunt este bună mulțumesc în să că vreau aici astăzi eu acum".split(" "));
const STRONG_GERMAN_MARKERS = new Set("deutsch straße grüße guten morgen danke".split(" "));

export function detectLanguage(text: string): LanguageId | null {
	// Ignore earlier sentences when classifying the text at the cursor. The caller
	// already bounds this input; trimming to its final sentence avoids stale
	// language evidence in mixed-language notes.
	const trimmed = text.trim();
	const withoutTrailingPunctuation = trimmed.replace(/[.!?…]+$/u, "");
	const sentences = withoutTrailingPunctuation.split(/[.!?…\n]+/u);
	const localText = sentences[sentences.length - 1] ?? "";
	const normalized = localText.toLocaleLowerCase();
	// Tokenize with Unicode letter properties so words beginning or ending in
	// Romanian diacritics have the same boundaries as ASCII words.
	// Keep classification local to the cursor. A long sentence can contain
	// evidence from both languages, so older words must not outvote a new
	// Romanian phrase. Five words also gives enough room to resolve ordinary
	// Romanian words that carry no diacritics.
	const allWords = normalized.match(/\p{L}+/gu) ?? [];
	const words = allWords.slice(-5);

	const cyrillicLetters = normalized.match(/[а-яё]/giu)?.length ?? 0;
	if (cyrillicLetters >= 3) return "ru";

	const scores: Record<"en" | "de" | "ro", number> = { en: 0, de: 0, ro: 0 };

	// Diacritics are useful evidence, but a single partially typed character
	// should not override a language selected from stronger context.
	scores.de += Math.min(4, (normalized.match(/[äöüß]/gu)?.length ?? 0) * 2);
	scores.ro += Math.min(4, (normalized.match(/[ăâîșț]/gu)?.length ?? 0) * 2);

	for (const language of Object.keys(LANGUAGE_MARKERS) as Array<keyof typeof LANGUAGE_MARKERS>) {
		for (const word of words) {
			if (LANGUAGE_MARKERS[language].has(word)) scores[language] += 2;
		}
	}
	for (const word of words) {
		if (STRONG_ROMANIAN_MARKERS.has(word)) scores.ro += 2;
		if (STRONG_GERMAN_MARKERS.has(word)) scores.de += 2;
	}

	// A distinctive newly typed Romanian word (including a diacritic word)
	// should be enough to switch from a prior language immediately.
	const newestWord = words[words.length - 1];
	if (newestWord && STRONG_ROMANIAN_MARKERS.has(newestWord)) return "ro";
	if (newestWord && STRONG_GERMAN_MARKERS.has(newestWord)) return "de";
	if (newestWord && /[ăâîșț]/u.test(newestWord)) return "ro";
	if (newestWord && /[äöüß]/u.test(newestWord)) return "de";

	const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
	const [best, second] = ranked;

	if (!best || best[1] < MINIMUM_CONFIDENCE
		|| (second && best[1] - second[1] < MINIMUM_CONFIDENCE_MARGIN)) return null;

	return best[0] as Exclude<LanguageId, "ru">;
}

/** Keep the current language when context is weak or automatic mode is off. */
export function resolveLanguage(
	text: string,
	currentLanguage: LanguageId,
	mode: "auto" | "manual",
): LanguageId {
	if (mode === "manual") return currentLanguage;
	return detectLanguage(text) ?? currentLanguage;
}
