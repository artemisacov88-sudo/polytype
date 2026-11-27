import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "polytype-multilingual-evaluation-"));
const output = join(temporary, "evaluate.cjs");
try {
	await build({
		entryPoints: [join(root, "scripts/evaluation/evaluate-multilingual.ts")],
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile: output,
		logLevel: "silent",
	});
	const result = spawnSync(process.execPath, [output], { cwd: root, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
	await rm(temporary, { recursive: true, force: true });
}
