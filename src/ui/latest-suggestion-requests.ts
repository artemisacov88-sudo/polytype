/** Prevent a late provider response from replacing results for newer editor text. */
export class LatestSuggestionRequests<T> {
	private generation = 0;
	private latestPromise: Promise<readonly T[]> | null = null;
	private latestResults: readonly T[] = [];

	request(produce: () => Promise<readonly T[]>): Promise<readonly T[]> {
		const generation = ++this.generation;
		const pending = Promise.resolve().then(produce).then((results) => {
			const copy = [...results];
			if (generation === this.generation) this.latestResults = copy;
			return copy;
		});
		this.latestPromise = pending;

		return pending.then((results) => generation === this.generation
			? results
			: this.waitForLatest());
	}

	private async waitForLatest(): Promise<readonly T[]> {
		while (true) {
			const generation = this.generation;
			const pending = this.latestPromise;
			if (!pending) return [...this.latestResults];
			try {
				const results = await pending;
				if (generation === this.generation) return [...results];
			} catch {
				if (generation === this.generation) return [...this.latestResults];
			}
		}
	}
}
