import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { WordIndex, type WordIndexEntry } from "../prediction/index/word-index";

const source = await readFile("src/prediction/data/english-words.json", "utf8");
const entries = JSON.parse(source) as WordIndexEntry[];
const heapBeforeBuild = process.memoryUsage().heapUsed;
const buildStarted = performance.now();
const index = new WordIndex(entries);
const buildMs = performance.now() - buildStarted;
const indexHeapMb = (process.memoryUsage().heapUsed - heapBeforeBuild) / (1024 * 1024);

console.log(`Indexed ${index.size} words in ${buildMs.toFixed(2)} ms.`);
console.log(`Approximate trie heap increase: ${indexHeapMb.toFixed(2)} MiB (Node.js heap measurement).`);
for (const prefix of ["a", "th", "comp", "xyz"]) {
	const iterations = 1000;
	const queryStarted = performance.now();
	for (let i = 0; i < iterations; i++) index.suggest(prefix, 5);
	const queryTotalMs = performance.now() - queryStarted;
	console.log(
		`Prefix ${JSON.stringify(prefix)} (${iterations} queries): ${queryTotalMs.toFixed(2)} ms total, ${(queryTotalMs / iterations).toFixed(4)} ms average.`,
	);
}
