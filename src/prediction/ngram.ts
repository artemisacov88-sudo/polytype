export type Tokenize = (text: string) => string[];
export type NormalizeWord = (word: string) => string;

export interface NGramPrediction {
	word: string;
	count: number;
	contextCount: number;
	contextLength: number;
}

export class NGramModel {
        private counts = new Map<string, Map<string, number>>();

        constructor(
                sentences: readonly string[],
                private tokenize: Tokenize,
                private normalize: NormalizeWord,
                private maxContext = 3,
        ) {
                this.train(sentences);
        }

        private train(sentences: readonly string[]): void {
                for (const sentence of sentences) {
                        const words = this.tokenize(sentence)
                                .map(this.normalize)
                                .filter(Boolean);

                        for (let i = 0; i < words.length; i++) {
                                for (
                                        let size = 0;
                                        size <= Math.min(this.maxContext, i);
                                        size++
                                ) {
                                        const context = words
                                                .slice(i - size, i)
                                                .join(" ");

                                        const nextWord = words[i];
                                        let candidates = this.counts.get(context);

                                        if (!candidates) {
                                                candidates = new Map<string, number>();
                                                this.counts.set(context, candidates);
                                        }

                                        candidates.set(
                                                nextWord,
                                                (candidates.get(nextWord) ?? 0) + 1,
                                        );
                                }
                        }
                }
        }

        predict(
                contextWords: readonly string[],
                currentPrefix: string,
                limit = 5,
        ): string[] {
		return this.predictScored(contextWords, currentPrefix, limit).map(({ word }) => word);
	}

	/** Returns the most specific matching context, with its observed counts. */
	predictScored(
		contextWords: readonly string[],
		currentPrefix: string,
		limit = 5,
	): NGramPrediction[] {
		if (limit <= 0) return [];

                const context = contextWords
                        .map(this.normalize)
                        .filter(Boolean)
                        .slice(-this.maxContext);

                const prefix = this.normalize(currentPrefix);

                for (let size = context.length; size >= 0; size--) {
			// slice(-0) means slice(0), which keeps the full array. The unigram
			// backoff key must instead represent the empty preceding context.
			const key = size === 0 ? "" : context.slice(-size).join(" ");
                        const candidates = this.counts.get(key);

                        if (!candidates) continue;

			const contextCount = [...candidates.values()].reduce((sum, count) => sum + count, 0);
			const results = [...candidates.entries()]
                                .filter(([word]) => word.startsWith(prefix))
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                                .slice(0, limit)
				.map(([word, count]) => ({
					word,
					count,
					contextCount,
					contextLength: size,
				}));

                        if (results.length > 0) return results;
                }

                return [];
        }
}
