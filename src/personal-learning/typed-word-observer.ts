import { english } from "../language/modules/english";

export interface CompletedTypedWord {
	word: string;
	wordStartCh: number;
	context: readonly string[];
}

export interface AcceptedSuggestionMarker {
	line: number;
	word: string;
	wordStartCh: number;
	acceptedLineText: string;
}

export interface WordRules {
	tokenize(text: string): string[];
	normalizeWord(word: string): string;
}

export type AcceptedMarkerDisposition = "keep" | "consume" | "discard";

/** Matches a typed delimiter to the exact suggestion insertion, without a time window. */
export function classifyAcceptedMarker(
	marker: AcceptedSuggestionMarker,
	line: number,
	lineText: string,
	completed?: CompletedTypedWord,
): AcceptedMarkerDisposition {
	if (marker.line !== line) return "discard";
	if (lineText === marker.acceptedLineText) return "keep";
	if (completed && completed.word === marker.word && completed.wordStartCh === marker.wordStartCh) return "consume";
	return "discard";
}

/** Detects one newly completed word typed incrementally at the end of a line. */
export function detectCompletedTypedWord(
	previousLine: string,
	currentLine: string,
	rules: WordRules = english.rules,
): CompletedTypedWord | undefined {
	if (currentLine.length !== previousLine.length + 1 || !currentLine.startsWith(previousLine)) return undefined;
	const inserted = currentLine.slice(previousLine.length);
	if (!/^[\s,.;:!?()[\]{}"“”…]$/u.test(inserted)) return undefined;

	const tokens = rules.tokenize(previousLine);
	if (tokens.length === 0) return undefined;
	const word = tokens[tokens.length - 1];
	const wordStartCh = previousLine.lastIndexOf(word);
	return {
		word: rules.normalizeWord(word),
		wordStartCh,
		context: rules.tokenize(previousLine.slice(0, wordStartCh)).slice(-3)
			.map((token) => rules.normalizeWord(token)),
	};
}
