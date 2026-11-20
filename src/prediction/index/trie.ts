export interface TrieEntry {
	word: string;
	frequency: number;
	pos?: string;
}

interface TrieNode {
	/** Shared character segment from the parent node to this node. */
	segment: string;
	children: Map<string, TrieNode>;
	entry?: TrieEntry;
}

/** Case-insensitive radix Trie. Returned entries are ordered by corpus frequency. */
export class Trie {
	private readonly root: TrieNode = { segment: "", children: new Map() };
	private entryCount = 0;

	get size(): number {
		return this.entryCount;
	}

	get(word: string): TrieEntry | undefined {
		const normalized = word.toLocaleLowerCase("en-US");
		let node = this.root;
		let offset = 0;
		while (offset < normalized.length) {
			const child = node.children.get(normalized[offset]);
			if (!child) return undefined;
			const shared = commonPrefixLength(child.segment, normalized.slice(offset));
			if (shared !== child.segment.length) return undefined;
			offset += shared;
			node = child;
		}
		return node.entry;
	}

	insert(entry: TrieEntry): void {
		const word = entry.word.toLocaleLowerCase("en-US");
		if (!word) return;

		let node = this.root;
		let offset = 0;
		while (offset < word.length) {
			let child = node.children.get(word[offset]);
			if (!child) {
				child = { segment: word.slice(offset), children: new Map() };
				child.entry = { ...entry, word };
				node.children.set(child.segment[0], child);
				this.entryCount++;
				return;
			}

			const shared = commonPrefixLength(child.segment, word.slice(offset));
			if (shared < child.segment.length) {
				const parent: TrieNode = {
					segment: child.segment.slice(0, shared),
					children: new Map(),
				};
				child.segment = child.segment.slice(shared);
				parent.children.set(child.segment[0], child);
				node.children.set(parent.segment[0], parent);
				node = parent;
				offset += shared;
				if (offset === word.length) {
					node.entry = { ...entry, word };
					this.entryCount++;
				} else {
					const leaf: TrieNode = {
						segment: word.slice(offset),
						children: new Map(),
						entry: { ...entry, word },
					};
					node.children.set(leaf.segment[0], leaf);
					this.entryCount++;
				}
				return;
			}

			offset += shared;
			node = child;
		}

		if (!node.entry) this.entryCount++;
		node.entry = { ...entry, word };
	}

	/** Returns at most `limit` matching words, highest frequency first. */
	suggest(prefix: string, limit = 5): TrieEntry[] {
		if (limit <= 0) return [];

		let node = this.root;
		const normalizedPrefix = prefix.toLocaleLowerCase("en-US");
		let offset = 0;
		while (offset < normalizedPrefix.length) {
			const child = node.children.get(normalizedPrefix[offset]);
			if (!child) return [];
			const remaining = normalizedPrefix.slice(offset);
			const shared = commonPrefixLength(child.segment, remaining);
			if (shared < Math.min(child.segment.length, remaining.length)) return [];
			offset += shared;
			node = child;
			if (offset === normalizedPrefix.length) break;
		}

		const matches: TrieEntry[] = [];
		const visit = (current: TrieNode): void => {
			if (current.entry) matches.push(current.entry);
			for (const child of current.children.values()) visit(child);
		};
		visit(node);

		matches.sort((a, b) => b.frequency - a.frequency || a.word.localeCompare(b.word));
		return matches.slice(0, limit);
	}
}

function commonPrefixLength(left: string, right: string): number {
	let length = 0;
	while (length < left.length && length < right.length && left[length] === right[length]) length++;
	return length;
}
