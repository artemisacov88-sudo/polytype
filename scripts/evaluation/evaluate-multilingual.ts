import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getLanguageModule } from "../../src/language/registry";
import { MultilingualPredictionProvider } from "../../src/prediction/multilingual-provider";

const ROOT = resolve(process.cwd());
const SNAPSHOT_ROOT = join(ROOT, "local-corpora/tatoeba/snapshot-2026-11-21");
const MODEL_ROOT = join(SNAPSHOT_ROOT, "models");
const DATABASE_ROOT = join(SNAPSHOT_ROOT, "metadata");
const PREPARED_ROOT = join(SNAPSHOT_ROOT, "prepared");
const OUTPUT = join(SNAPSHOT_ROOT, "evaluation/validation-test.json");
const LANGUAGES = ["ru", "de", "ro"] as const;
const CONFIGS = ["moderate", "compact"] as const;
const MAX_EXAMPLES = 10_000;
const SEED = 7007;

interface Example {
	id: string;
	context: string[];
	target: string;
}

interface Metrics {
	queries: number;
	coverage: number;
	candidate_recall: number;
	top5_accuracy: number;
}

function sampleExamples(language: string, split: "validation" | "test"): Example[] {
	const path = join(PREPARED_ROOT, language, `${split}.jsonl`);
	const examples: Example[] = [];
	let seen = 0;
	let randomState = (SEED ^ language.charCodeAt(0) ^ (split === "test" ? 0x51ed270b : 0)) >>> 0;
	const random = () => {
		randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
		return randomState / 0x1_0000_0000;
	};
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line) continue;
		const record = JSON.parse(line) as { document: string; tokens: string[] };
		for (let position = 1; position < record.tokens.length; position++) {
			const target = record.tokens[position];
			const example = {
				id: `${record.document}:${position}`,
				context: record.tokens.slice(Math.max(0, position - 3), position),
				target,
			};
			seen++;
			if (examples.length < MAX_EXAMPLES) examples.push(example);
			else {
				const slot = Math.floor(random() * seen);
				if (slot < MAX_EXAMPLES) examples[slot] = example;
			}
		}
	}
	return examples.sort((left, right) => left.id.localeCompare(right.id));
}

async function evaluate(language: typeof LANGUAGES[number], config: string, split: "validation" | "test") {
	const examples = sampleExamples(language, split);
	const module = getLanguageModule(language);
	const assetDirectory = (id: string) => join(MODEL_ROOT, id, config);
	const errors: string[] = [];
	const provider = new MultilingualPredictionProvider(
		{ predict: async () => [] },
		async (path) => readFileSync(path, "utf8"),
		async (path) => {
			const bytes = readFileSync(path);
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
		(message) => errors.push(message),
		assetDirectory,
	);
	let coverage = 0;
	let candidateHits = 0;
	let top5 = 0;
	for (const example of examples) {
		const prefix = module.rules.normalizeWord(example.target.slice(0, Math.min(3, example.target.length)));
		const result = await provider.predictDetailed({ language, context: example.context, currentWord: prefix });
		if (result.suggestions.length > 0) coverage++;
		if (result.candidatePool.includes(example.target)) candidateHits++;
		if (result.suggestions.includes(example.target)) top5++;
	}
	if (errors.length) throw new Error(`${language}/${config} failed to load: ${errors.join("; ")}`);
	const count = examples.length || 1;
	const metrics: Metrics = {
		queries: examples.length,
		coverage: coverage / count,
		candidate_recall: candidateHits / count,
		top5_accuracy: top5 / count,
	};
	const base = assetDirectory(language);
	const files = ["words.json", "binary/model.ptng", "binary/context-stats.ptgs"];
	return {
		metrics,
		model_bytes: files.reduce((sum, relative) => sum + statSync(join(base, relative)).size, 0),
		model_sha256: Object.fromEntries(files.map((relative) => [relative,
			createHash("sha256").update(readFileSync(join(base, relative))).digest("hex")])),
		split_path: resolve(PREPARED_ROOT, language, `${split}.jsonl`),
	};
}

function chooseConfig(results: Record<string, Awaited<ReturnType<typeof evaluate>>>): string {
	return [...CONFIGS].sort((left, right) =>
		results[right].metrics.top5_accuracy - results[left].metrics.top5_accuracy
		|| results[left].model_bytes - results[right].model_bytes,
	)[0];
}

async function main() {
	if (statSync(SNAPSHOT_ROOT).isDirectory() === false) throw new Error("Tatoeba snapshot is missing");
	if (existsSync(OUTPUT)) throw new Error(`Refusing to overwrite ${OUTPUT}`);
	const report: Record<string, unknown> = {
		corpus: "Tatoeba 2026-11-21",
		license: "CC BY 2.0 FR",
		seed: SEED,
		max_examples_per_split: MAX_EXAMPLES,
		selection_rule: "Choose the highest validation Top-5 accuracy; break ties by smaller model bytes. Test split is evaluated once afterward and is never used for selection.",
		languages: {},
	};
	const languages: Record<string, unknown> = {};
	for (const language of LANGUAGES) {
		const validation: Record<string, Awaited<ReturnType<typeof evaluate>>> = {};
		for (const config of CONFIGS) validation[config] = await evaluate(language, config, "validation");
		const selected = chooseConfig(validation);
		const test = await evaluate(language, selected, "test");
		languages[language] = {
			validation,
			selected_config: selected,
			test,
			training_database_path: resolve(DATABASE_ROOT, `${language}-ngrams.sqlite3`),
		};
	}
	report.languages = languages;
	mkdirSync(join(SNAPSHOT_ROOT, "evaluation"), { recursive: true });
	writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
	console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
