import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { MultilingualPredictionProvider } from "../../src/prediction/multilingual-provider";
import type { LanguageId } from "../../src/language/types";

const ROOT = resolve(process.cwd());
const LANGUAGES = ["ru", "de", "ro"] as const;
const REQUESTS: Record<typeof LANGUAGES[number], { context: string[]; prefix: string }> = {
	ru: { context: ["я"], prefix: "г" },
	de: { context: ["ich"], prefix: "g" },
	ro: { context: ["eu"], prefix: "c" },
};
const WARM_ITERATIONS = 100;

async function main(): Promise<void> {
	const reads = new Map<string, number>();
	const provider = new MultilingualPredictionProvider(
		{ predict: async () => [] },
		async (path) => {
			reads.set(path, (reads.get(path) ?? 0) + 1);
			return readFileSync(resolve(ROOT, "src/prediction", path), "utf8");
		},
		async (path) => {
			reads.set(path, (reads.get(path) ?? 0) + 1);
			const bytes = readFileSync(resolve(ROOT, "src/prediction", path));
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
		(message) => { throw new Error(message); },
	);
	const results = [];
	for (const language of LANGUAGES) {
		globalThis.gc?.();
		const before = process.memoryUsage();
		const request = REQUESTS[language];
		const coldStart = performance.now();
		const firstResult = await provider.predict({
			language,
			context: request.context,
			currentWord: request.prefix,
		});
		const coldLoadMs = performance.now() - coldStart;
		const latencies: number[] = [];
		for (let index = 0; index < WARM_ITERATIONS; index++) {
			const start = performance.now();
			await provider.predict({ language, context: request.context, currentWord: request.prefix });
			latencies.push(performance.now() - start);
		}
		latencies.sort((left, right) => left - right);
		globalThis.gc?.();
		const after = process.memoryUsage();
		const assetBase = `data/multilingual/${language}`;
		const modelBytes = ["words.json", "binary/model.ptng", "binary/context-stats.ptgs"]
			.reduce((total, name) => total + statSync(resolve(ROOT, `src/prediction/${assetBase}/${name}`)).size, 0);
		results.push({
			language,
			modelBytes,
			coldLoadMs: round(coldLoadMs),
			warmLatencyMs: { median: round(latencies[Math.floor(latencies.length * 0.5)]),
				p95: round(latencies[Math.floor(latencies.length * 0.95)]) },
				suggestionsOnFirstRequest: firstResult.length,
				memoryBeforeBytes: memorySnapshot(before),
				memoryAfterBytes: memorySnapshot(after),
				assetReads: Object.fromEntries([...reads].filter(([path]) => path.includes(`/${language}/`))),
		});
	}
	console.log(JSON.stringify({ runtime: process.version, iterations: WARM_ITERATIONS,
		cachePolicy: "one active non-English model", results }, null, 2));
}

function memorySnapshot(value: NodeJS.MemoryUsage): Record<string, number> {
	return { heapUsed: value.heapUsed, external: value.external, arrayBuffers: value.arrayBuffers, rss: value.rss };
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
