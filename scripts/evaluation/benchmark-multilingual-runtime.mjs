import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "polytype-multilingual-bench-"));
try {
	const output = join(temp, "benchmark.cjs");
	await build({
		entryPoints: [resolve(root, "scripts/evaluation/benchmark-multilingual-runtime.ts")],
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile: output,
		logLevel: "silent",
	});
	const result = spawnSync(process.execPath, ["--expose-gc", output], {
		cwd: root,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
	await rm(temp, { recursive: true, force: true });
}
