import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { ExperimentalBinaryPredictionProvider } from "../prediction/experimental-binary-provider";
import { NGramModelLoader, type NGramModelManifest } from "../prediction/ngram-model-loader";
import type { PredictionDataAsset } from "../prediction/data-source";
import type { PredictionRequest } from "../prediction/types";

const root = process.cwd();
const binaryPath = join(root, "data/experiments/moderate/binary/model.ptng");
const manifestPath = join(root, "data/experiments/moderate/manifest.json");
const referencePath = join(root, "data/experiments/moderate/json/model.json");
const statisticsPath = join(root, "data/experiments/moderate/binary/context-stats.ptgs");
let sourceBuffer: Buffer | null = readFileSync(binaryPath);
const sourceBytes = new ArrayBuffer(sourceBuffer.byteLength);
new Uint8Array(sourceBytes).set(sourceBuffer);
sourceBuffer = null;
const statsBuffer = readFileSync(statisticsPath);
const statisticsBytes = new ArrayBuffer(statsBuffer.byteLength);
new Uint8Array(statisticsBytes).set(statsBuffer);
const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText) as NGramModelManifest;

async function main(): Promise<void> {
	let binaryReads = 0;
	let manifestReads = 0;
	let statisticsReads = 0;
	let parserYields = 0;
	const loader = new NGramModelLoader(async (path) => {
		assert.equal(path, "data/experiments/moderate/binary/model.ptng");
		binaryReads++;
		return sourceBytes;
	}, async (path) => {
		assert.equal(path, "data/experiments/moderate/manifest.json");
		manifestReads++;
		return manifestText;
	}, undefined, undefined, undefined, async (path) => {
		assert.equal(path, "data/experiments/moderate/binary/context-stats.ptgs");
		statisticsReads++;
		return statisticsBytes;
	}, undefined, undefined, async () => {
		parserYields++;
		await new Promise<void>((resolve) => setImmediate(resolve));
	});
	assert.equal(binaryReads, 0, "model is lazy before first use");
	const loadStart = performance.now();
	const [model, concurrentModel, thirdModel] = await Promise.all([loader.load(), loader.load(), loader.load()]);
	const loadMs = performance.now() - loadStart;
	assert.strictEqual(model, concurrentModel);
	assert.strictEqual(model, thirdModel);
	assert.equal(binaryReads, 1, "parallel callers share the binary read");
	assert.equal(manifestReads, 1, "parallel callers share the manifest read");
	assert.equal(statisticsReads, 1, "parallel callers share the statistics read");
	assert.ok(parserYields > 0, "large binary parsing yields to the host event loop");
	const beforeSearchMemory = process.memoryUsage();
	const beforeSearch = performance.now();
	for (let index = 0; index < 100_000; index++) model.lookupContinuations(["i", "would", "like"], "t", 5);
	const searchMs = performance.now() - beforeSearch;

	assert.equal(model.getWordFrequency("the"), 658820);
	assert.equal(model.getWordFrequency("a-abaker"), 1, "companion stats restore frequencies omitted from pruned unigrams");
	assert.ok(!model.lookupContinuations([], "a-a", 100).continuations.some(({ word }) => word === "a-abaker"),
		"PTNG lookup retains stage-4 pruned unigram semantics");
	assert.ok(model.lookupFullUnigrams("a-a", 100).continuations.some(({ word }) => word === "a-abaker"),
		"experimental candidate generation can use full unigram statistics");
	assert.equal(model.getContextStatistics(["i", "would", "like"])?.continuationTypes, 25);
	assert.equal(model.getContextStatistics(["notawordneverpresent"]), undefined);
	assert.equal(model.getWordFrequency("UNKNOWN-WORD"), 0);
	assert.equal(model.hasWord("the"), true);
	assert.equal(model.hasWord("not-in-oanc"), false);
	assert.equal(model.hasContext(["i", "would", "like"]), true);
	assert.equal(model.hasContext(["missing", "context"]), false);
	assert.deepEqual(model.lookupContinuations(["missing"], "x", 5).continuations, []);
	assert.deepEqual(model.lookupContinuations(["i"], "w", 2).continuations.map(({ word }) => word).length, 2);
	assert.equal(model.lookupContinuations(["i", "would", "like"], "t", 0).continuations.length, 0);

	// Compare binary results with the accompanying JSON export for known contexts.
	const reference = JSON.parse(readFileSync(referencePath, "utf8")) as {
		version: number;
		vocabulary: string[];
		records: number[][];
	};
	assert.equal(reference.version, 1);
	const ids = new Map(reference.vocabulary.map((word, id) => [word, id]));
	assert.equal(reference.vocabulary.length, model.vocabularySize);
	assertReference(model, reference, ["i"], "w", 2, ids);
	assertReference(model, reference, ["i", "would"], "l", 3, ids);
	assertReference(model, reference, ["i", "would", "like"], "t", 4, ids);
	assertReference(model, reference, [], "th", 1, ids);

	// A failed first read is not cached; the next request retries successfully.
	let retryReads = 0;
	const retryingLoader = new NGramModelLoader(async () => {
		retryReads++;
		if (retryReads === 1) throw new Error("simulated first read failure");
		return sourceBytes;
	}, async () => manifestText, undefined, undefined, undefined, async () => statisticsBytes);
	await assert.rejects(retryingLoader.load(), /simulated first read failure/);
	assert.equal((await retryingLoader.load()).getWordFrequency("the"), 658820);
	assert.equal(retryReads, 2);

	// SHA mismatch, unsupported version, and truncation all fail before use.
	const damaged = new Uint8Array(sourceBytes.slice(0));
	damaged[damaged.length - 1] ^= 1;
	const damagedLoader = new NGramModelLoader(async () => damaged.buffer, async () => manifestText);
	await assert.rejects(damagedLoader.load(), /SHA-256/);
	const damagedStats = new Uint8Array(statisticsBytes.slice(0));
	damagedStats[damagedStats.length - 1] ^= 1;
	const damagedStatsLoader = new NGramModelLoader(async () => sourceBytes, async () => manifestText,
		undefined, undefined, undefined, async () => damagedStats.buffer);
	await assert.rejects(damagedStatsLoader.load(), /Context statistics SHA-256/);

	const incompatible = new Uint8Array(sourceBytes.slice(0));
	new DataView(incompatible.buffer).setUint32(4, 99, true);
	const incompatibleManifest = { ...manifest, binary_sha256: sha256Hex(incompatible) };
	const incompatibleLoader = new NGramModelLoader(async () => incompatible.buffer,
		async () => JSON.stringify(incompatibleManifest));
	await assert.rejects(incompatibleLoader.load(), /Unsupported binary model format version: 99/);

	const truncated = new Uint8Array(sourceBytes.slice(0, 80));
	const truncatedManifest = { ...manifest, binary_bytes: truncated.byteLength, binary_sha256: sha256Hex(truncated) };
	const truncatedLoader = new NGramModelLoader(async () => truncated.buffer,
		async () => JSON.stringify(truncatedManifest));
	await assert.rejects(truncatedLoader.load(), /Truncated binary vocabulary|Truncated/);

	// Isolated provider compares the working provider with the binary-backed result.
	const provider = new ExperimentalBinaryPredictionProvider(
		(asset: PredictionDataAsset) => Promise.resolve(readFileSync(join(root, "src/prediction/data", asset), "utf8")),
		async () => sourceBytes,
		async () => manifestText,
		undefined,
		undefined,
		undefined,
		async () => statisticsBytes,
	);
	const request: PredictionRequest = { language: "en", context: ["I", "would", "like"], currentWord: "t" };
	const comparison = await provider.compare(request);
	assert.ok(comparison.baseline.length > 0);
	assert.ok(comparison.experimental.includes("to"));
	assert.equal(comparison.error, undefined);
	assert.ok((await provider.predict({ ...request, maxSuggestions: 2 })).length <= 2,
		"the experimental prediction route respects the configured suggestion count");

	const loadStandardAsset = (asset: PredictionDataAsset) =>
		Promise.resolve(readFileSync(join(root, "src/prediction/data", asset), "utf8"));
	const missingModelErrors: string[] = [];
	const missingModelProvider = new ExperimentalBinaryPredictionProvider(
		loadStandardAsset,
		async () => { throw new Error("ENOENT: model.ptng"); },
		async () => manifestText,
		(message) => missingModelErrors.push(message),
	);
	const missingModelResult = await missingModelProvider.compare(request);
	assert.deepEqual(missingModelResult.experimental, missingModelResult.baseline,
		"a missing binary model preserves ordinary Dictionary provider predictions");
	assert.match(missingModelResult.error ?? "", /ENOENT/);
	assert.equal(missingModelErrors.length, 1);

	const corruptedBinary = new Uint8Array(sourceBytes.slice(0));
	corruptedBinary[corruptedBinary.length - 1] ^= 1;
	const corruptModelProvider = new ExperimentalBinaryPredictionProvider(
		loadStandardAsset,
		async () => corruptedBinary.buffer,
		async () => manifestText,
	);
	const corruptModelResult = await corruptModelProvider.compare(request);
	assert.deepEqual(corruptModelResult.experimental, corruptModelResult.baseline,
		"a checksum-invalid binary model preserves ordinary Dictionary provider predictions");
	assert.match(corruptModelResult.error ?? "", /SHA-256/);

	const smoothed = await provider.compare(request, "interpolated-absolute-discount");
	assert.equal(smoothed.algorithm, "interpolated-absolute-discount");
	assert.ok(smoothed.experimental.length > 0);
	const unknownContext = await provider.compare({ ...request, context: ["notawordneverpresent"] },
		"interpolated-absolute-discount");
	assert.equal(unknownContext.algorithm, "longest-context", "unknown context safely falls back to available prefix candidates");
	assert.ok(unknownContext.experimental.every((word) => word.startsWith("t")));
	const providerStart = performance.now();
	for (let index = 0; index < 100; index++) await provider.compare(request, "interpolated-absolute-discount");
	const candidateLatencyMs = (performance.now() - providerStart) / 100;
	let nonEnglishReads = 0;
	const nonEnglishProvider = new ExperimentalBinaryPredictionProvider(
		async () => "[]",
		async () => { nonEnglishReads++; return sourceBytes; },
		async () => manifestText,
	);
	await nonEnglishProvider.predict({ language: "ru", context: [], currentWord: "при" });
	assert.equal(nonEnglishReads, 0, "non-English use does not load the English binary model");

	console.log(`Binary loader Node benchmark: load ${loadMs.toFixed(1)} ms; 100k context lookups ${searchMs.toFixed(1)} ms; heap after load ${Math.round(beforeSearchMemory.heapUsed / 1024 / 1024)} MiB; RSS after load ${Math.round(beforeSearchMemory.rss / 1024 / 1024)} MiB; mean IAD candidate latency ${candidateLatencyMs.toFixed(3)} ms.`);
	console.log("Binary loader, JSON parity, retry, integrity, and experimental provider tests passed.");
}

function assertReference(
	model: Awaited<ReturnType<NGramModelLoader["load"]>>,
	reference: { vocabulary: string[]; records: number[][] },
	context: string[],
	prefix: string,
	order: number,
	ids: Map<string, number>,
): void {
	const contextIds = context.map((word) => ids.get(word));
	assert.ok(contextIds.every((id) => id !== undefined));
	const expected: Array<{ word: string; frequency: number }> = [];
	let contextFrequency = 0;
	for (const record of reference.records) {
		if (record[0] !== order) continue;
		let match = true;
		for (let index = 0; index < contextIds.length; index++) {
			if (record[index + 1] !== contextIds[index]) { match = false; break; }
		}
		if (!match) continue;
		const target = reference.vocabulary[record[order]];
		const frequency = record[order + 1];
		contextFrequency += frequency;
		if (target.startsWith(prefix)) expected.push({ word: target, frequency });
	}
	const actual = model.lookupContinuations(context, prefix, 20);
	assert.deepEqual(actual.continuations.map(({ word, frequency }) => ({ word, frequency })), expected.slice(0, 20));
	assert.equal(actual.contextFrequency, contextFrequency);
	assert.equal(model.getContextFrequency(context), contextFrequency);
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
