import { Trie, type TrieEntry } from "./trie";

export interface WordIndexEntry extends TrieEntry {
	pos: string;
}

/** Builds the in-memory prefix index from a supplied local word list. */
export class WordIndex {
	private readonly trie = new Trie();
	private maximumFrequency = 0;

	constructor(entries: readonly WordIndexEntry[]) {
		for (const entry of entries) {
			this.trie.insert(entry);
			this.maximumFrequency = Math.max(this.maximumFrequency, entry.frequency);
		}
	}

	get size(): number {
		return this.trie.size;
	}

	getEntry(word: string): TrieEntry | undefined {
		return this.trie.get(word);
	}

	get maxFrequency(): number {
		return this.maximumFrequency;
	}

	suggest(prefix: string, limit = 5): string[] {
		return this.trie.suggest(prefix, limit).map(({ word }) => word);
	}
}
