import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Trie } from "../prediction/index/trie";
import { WordIndex } from "../prediction/index/word-index";
import { DictionaryPredictionProvider } from "../prediction/provider";

const trie = new Trie();
trie.insert({ word: "care", frequency: 20 });
trie.insert({ word: "car", frequency: 50 });
trie.insert({ word: "cart", frequency: 10 });
trie.insert({ word: "cat", frequency: 30 });
trie.insert({ word: "dog", frequency: 100 });

assert.equal(trie.size, 5, "counts inserted words");
assert.deepEqual(
	trie.suggest("ca").map(({ word }) => word),
	["car", "cat", "care", "cart"],
	"returns all prefix matches ranked by frequency",
);
assert.deepEqual(
	trie.suggest("CAR").map(({ word }) => word),
	["car", "care", "cart"],
	"matches prefixes without regard to case",
);
assert.deepEqual(
	trie.suggest("car", 2).map(({ word }) => word),
	["car", "care"],
	"honors the result limit",
);
assert.deepEqual(trie.suggest("z"), [], "returns no words for an unknown prefix");
assert.deepEqual(trie.suggest("", 0), [], "returns no results for a zero limit");

const duplicate = new Trie();
duplicate.insert({ word: "Word", frequency: 1 });
duplicate.insert({ word: "word", frequency: 4 });
assert.equal(duplicate.size, 1, "case-normalized duplicate words occupy one entry");
assert.deepEqual(duplicate.suggest("wo"), [{ word: "word", frequency: 4 }]);

const wordIndex = new WordIndex([
	{ word: "index", frequency: 10, pos: "NOUN" },
	{ word: "inside", frequency: 5, pos: "ADV" },
]);
assert.equal(wordIndex.size, 2);
assert.equal(wordIndex.getEntry("INDEX")?.frequency, 10);
assert.deepEqual(wordIndex.suggest("in"), ["index", "inside"]);

async function verifyOancProvider(): Promise<void> {
	const provider = new DictionaryPredictionProvider((asset) =>
		readFile(`src/prediction/data/${asset}`, "utf8"),
	);
	const results = await provider.predict({
		context: ["unseen-context"],
		language: "en",
		currentWord: "comput",
	});
	assert.ok(results.includes("computer"), "provider completes words from the full OANC list");
	console.log("Trie tests and OANC provider integration passed.");
}

void verifyOancProvider().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
