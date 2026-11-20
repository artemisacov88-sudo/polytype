import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tests = [
	"src/tests/trie-test.ts",
	"src/tests/ngram-test.ts",
	"src/tests/ngram-model-loader-test.ts",
	"src/tests/prediction-components-test.ts",
	"src/tests/ranking-test.ts",
	"src/tests/collocations-test.ts",
	"src/tests/provider-test.ts",
	"src/tests/language-test.ts",
	"src/tests/detector-test.ts",
];

async function main() {
	const outputDirectory = await mkdtemp(join(tmpdir(), "polytype-tests-"));
	const failures = [];
	try {
		for (const [index, testPath] of tests.entries()) {
			const outputPath = join(outputDirectory, `test-${index}.cjs`);
			try {
				const result = await build({
					entryPoints: [resolve(root, testPath)],
					bundle: true,
					platform: "node",
					format: "cjs",
					outfile: outputPath,
					logLevel: "silent",
				});
				if (result.errors.length > 0) throw new Error("esbuild reported errors");
				const execution = spawnSync(process.execPath, [outputPath], {
					cwd: root,
					stdio: "inherit",
				});
				if (execution.error) throw execution.error;
				if (execution.status !== 0) throw new Error(`test process exited with ${execution.status}`);
			} catch (error) {
				failures.push(testPath);
				console.error(`FAIL ${testPath}:`, error);
			}
		}
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
	}

	const pythonTests = spawnSync("python3", ["-m", "unittest", "discover", "-s", "scripts/tests", "-v"], {
		cwd: root,
		stdio: "inherit",
	});
	if (pythonTests.error || pythonTests.status !== 0) failures.push("scripts/tests/test_pipeline.py");

	if (failures.length > 0) {
		console.error(`\n${failures.length}/${tests.length} test files failed: ${failures.join(", ")}`);
		process.exitCode = 1;
	} else {
		console.log(`\nAll ${tests.length} test files passed.`);
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
