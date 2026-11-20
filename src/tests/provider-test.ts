import assert from "node:assert/strict";
import { DictionaryPredictionProvider } from "../prediction/provider";
import type { PredictionDataAsset } from "../prediction/data-source";

const words = JSON.stringify([
	{ word: "hello", frequency: 100, pos: "NOUN" },
	{ word: "help", frequency: 80, pos: "VERB" },
]);
const collocations = JSON.stringify({
	hello: {
		NOUN_noun_after: [{ word: "world", count: 8, score: 9 }],
	},
});

async function testLanguageLazyLoading(): Promise<void> {
	let calls = 0;
	const provider = new DictionaryPredictionProvider(async () => {
		calls++;
		throw new Error("should not be read for this language");
	});
	assert.deepEqual(await provider.predict({ language: "ru", context: [], currentWord: "пр" }), []);
	assert.equal(calls, 0, "non-English queries do not load English files");
}

async function testConcurrentDeduplication(): Promise<void> {
	const calls: PredictionDataAsset[] = [];
	const provider = new DictionaryPredictionProvider(async (asset) => {
		calls.push(asset);
		await new Promise((resolve) => setTimeout(resolve, 5));
		return asset === "english-words.json" ? words : collocations;
	});
	const request = { language: "en" as const, context: ["hello"], currentWord: "wo" };
	const [first, second] = await Promise.all([provider.predict(request), provider.predict(request)]);
	assert.ok(first.includes("world"));
	assert.deepEqual(second, first);
	assert.deepEqual(calls.sort(), ["english-collocations.json", "english-words.json"]);
}

async function testRetryAfterMissingWordFile(): Promise<void> {
	let wordReads = 0;
	const errors: string[] = [];
	const provider = new DictionaryPredictionProvider(async (asset) => {
		if (asset === "english-collocations.json") return collocations;
		wordReads++;
		if (wordReads === 1) throw new Error("ENOENT");
		return words;
	}, (message) => errors.push(message));
	const request = { language: "en" as const, context: [], currentWord: "hel" };
	await assert.doesNotReject(provider.predict(request));
	assert.ok(errors[0]?.includes('Could not read local resource "english-words.json"'));
	const retry = await provider.predict(request);
	assert.ok(retry.includes("hello"), "a later request retries and uses the recovered resource");
	assert.equal(wordReads, 2);
}

async function testMalformedCollocationsDoNotBlockTrie(): Promise<void> {
	let collocationReads = 0;
	const errors: string[] = [];
	const provider = new DictionaryPredictionProvider(async (asset) => {
		if (asset === "english-words.json") return words;
		collocationReads++;
		return "{";
	}, (message) => errors.push(message));
	const results = await provider.predict({ language: "en", context: ["hello"], currentWord: "hel" });
	assert.ok(results.includes("hello"), "word suggestions survive a collocation parse error");
	assert.ok(errors[0]?.includes('Could not parse local resource "english-collocations.json"'));
	assert.equal(collocationReads, 1);
}

async function testMalformedWordJsonCanRetry(): Promise<void> {
	let wordReads = 0;
	const errors: string[] = [];
	const provider = new DictionaryPredictionProvider(async (asset) => {
		if (asset === "english-collocations.json") return collocations;
		wordReads++;
		return wordReads === 1 ? "{" : words;
	}, (message) => errors.push(message));
	const request = { language: "en" as const, context: [], currentWord: "hel" };
	await assert.doesNotReject(provider.predict(request));
	assert.ok(errors[0]?.includes('Could not parse local resource "english-words.json"'));
	assert.ok((await provider.predict(request)).includes("hello"));
	assert.equal(wordReads, 2);
}

async function main(): Promise<void> {
	await testLanguageLazyLoading();
	await testConcurrentDeduplication();
	await testRetryAfterMissingWordFile();
	await testMalformedCollocationsDoNotBlockTrie();
	await testMalformedWordJsonCanRetry();
	console.log("Provider and local-data loading tests passed.");
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
