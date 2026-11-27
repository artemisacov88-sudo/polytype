import type { SpellingIssue, SpellingWord } from "./spelling-types";

export class SpellingIssueCache {
	private readonly values = new Map<string, readonly SpellingIssue[]>();
	private readonly order: string[] = [];

	constructor(private readonly maximumEntries = 10_000) {}

	get(word: SpellingWord): readonly SpellingIssue[] | undefined {
		const key = `${word.language ?? "auto"}:${word.searchForm}`;
		const value = this.values.get(key);
		if (value) {
			const index = this.order.indexOf(key);
			if (index >= 0) this.order.splice(index, 1);
			this.order.push(key);
		}
		return value;
	}

	set(word: SpellingWord, issues: readonly SpellingIssue[]): void {
		const key = `${word.language ?? "auto"}:${word.searchForm}`;
		if (!this.values.has(key)) {
			this.order.push(key);
			if (this.order.length > this.maximumEntries) {
				const oldest = this.order.shift();
				if (oldest) this.values.delete(oldest);
			}
		}
		this.values.set(key, issues);
	}
}
