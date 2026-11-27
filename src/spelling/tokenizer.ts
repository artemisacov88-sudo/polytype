import type { LanguageId } from "../language/types";
import { createSpellingWord } from "./normalization";
import type { SpellingWord } from "./spelling-types";

const WORD_PATTERN = /[\p{L}\p{M}]+(?:['’ʼ`][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}]+)*|[\p{L}\p{M}]+/gu;

export interface TokenizeSpellingOptions {
	language?: LanguageId;
	minimumLength?: number;
}

export function tokenizeSpellingText(
	text: string,
	options: TokenizeSpellingOptions = {},
): SpellingWord[] {
	const words: SpellingWord[] = [];
	const minimumLength = options.minimumLength ?? 1;
	WORD_PATTERN.lastIndex = 0;

	for (const match of text.matchAll(WORD_PATTERN)) {
		const surfaceForm = match[0];
		const from = match.index ?? 0;
		const to = from + surfaceForm.length;
		if ([...surfaceForm].length < minimumLength) continue;
		const language = options.language;
		words.push(createSpellingWord(surfaceForm, from, to, language));
	}

	return words;
}
