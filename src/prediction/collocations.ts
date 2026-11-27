export interface Partner {
        word: string;
        count: number;
        score: number;
}

export type CollocationData = Record<
        string,
        Record<string, Partner[]>
>;

// Связи, в которых партнёр может идти после текущего слова.
const FORWARD_RELATIONS = [
        "NOUN_noun_after",
        "NOUN_prep_after",
        "VERB_noun_object",
        "VERB_prep_after",
        "ADJ_noun",
        "ADJ_prep_after",
];

export function getCollocationSuggestions(
        previousWord: string,
        prefix: string,
        limit = 5,
): string[] {
	return getCollocationCandidates(previousWord, prefix)
		.slice(0, limit)
		.map(({ word }) => word);
}

export function getCollocationCandidates(previousWord: string, prefix: string): Partner[] {
	try {
		const data = require("./data/english-collocations.json") as CollocationData;
		return findCollocationCandidates(data, previousWord, prefix);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.error(`[PolyType] Could not load local resource "english-collocations.json": ${detail}`);
		return [];
	}
}

/** Pure lookup for the asynchronously loaded local data used by the provider. */
export function findCollocationCandidates(
	data: CollocationData,
	previousWord: string,
	prefix: string,
): Partner[] {
        const headword = previousWord.toLocaleLowerCase("en-US");
        const normalizedPrefix = prefix.toLocaleLowerCase("en-US");

	const entry = data[headword];

	if (!entry) return [];

        const candidates = new Map<string, Partner>();

        for (const relation of FORWARD_RELATIONS) {
                const partners = entry[relation] ?? [];

                for (const partner of partners) {
                        if (!partner.word.startsWith(normalizedPrefix)) {
                                continue;
                        }

                        const existing = candidates.get(partner.word);

                        if (
                                !existing ||
                                partner.score > existing.score
                        ) {
                                candidates.set(partner.word, partner);
                        }
                }
        }

	return [...candidates.values()]
                .sort((a, b) =>
                        b.score - a.score ||
                        b.count - a.count,
		);
}
