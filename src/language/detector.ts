import type { LanguageId } from "./types";

const LANGUAGE_MARKERS: Record<Exclude<LanguageId, "ru">, RegExp> = {
	en: /\b(the|and|this|that|with|have|you|are|for)\b/gi,
	de: /\b(der|die|das|und|ist|nicht|mit|ein|eine|guten|tag|wie|geht|dir|ich|du|hallo|danke)\b/gi,
	ro: /\b(și|sunt|este|pentru|care|acest|această|din|în)\b/gi,
};

export function detectLanguage(text: string): LanguageId | null {
	const normalized = text.toLocaleLowerCase();

	if (/[а-яё]/i.test(normalized)) return "ru";

	const scores = { en: 0, de: 0, ro: 0 };

	if (/[äöüß]/i.test(normalized)) scores.de += 3;
	if (/[ăâîșț]/i.test(normalized)) scores.ro += 3;

	for (const language of Object.keys(LANGUAGE_MARKERS) as Array<keyof typeof LANGUAGE_MARKERS>) {
		const matches = normalized.match(LANGUAGE_MARKERS[language]);
		scores[language] += matches ? matches.length * 2 : 0;
	}

	const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

	if (!best || best[1] === 0) return null;

	return best[0] as LanguageId;
}
