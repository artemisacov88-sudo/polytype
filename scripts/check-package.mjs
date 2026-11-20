import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredFiles = [
	"main.js",
	"manifest.json",
	"styles.css",
	"data/english-words.json",
	"data/english-collocations.json",
];

async function main() {
	for (const relativePath of requiredFiles) {
		const absolutePath = resolve(root, relativePath);
		try {
			await access(absolutePath);
			if (!(await stat(absolutePath)).isFile()) throw new Error("not a file");
		} catch (error) {
			throw new Error(`Production package is missing required file "${relativePath}": ${error.message}`);
		}
	}

	const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
	if (manifest.id !== "polytype" || typeof manifest.version !== "string") {
		throw new Error("manifest.json is missing a valid PolyType id or version");
	}

	const words = JSON.parse(await readFile(resolve(root, "data/english-words.json"), "utf8"));
	if (!Array.isArray(words) || words.length === 0 || !words.every((entry) =>
		typeof entry.word === "string" && typeof entry.frequency === "number" && typeof entry.pos === "string")) {
		throw new Error("data/english-words.json is empty or has an invalid word-list structure");
	}

	const collocations = JSON.parse(await readFile(resolve(root, "data/english-collocations.json"), "utf8"));
	if (!collocations || typeof collocations !== "object" || Array.isArray(collocations)
		|| Object.keys(collocations).length === 0) {
		throw new Error("data/english-collocations.json is empty or has an invalid structure");
	}

	console.log("Production package verified:");
	for (const relativePath of requiredFiles) {
		const { size } = await stat(resolve(root, relativePath));
		console.log(`  ${relativePath} (${(size / 1024).toFixed(1)} KiB)`);
	}
}

void main().catch((error) => {
	console.error(`[PolyType] ${error.message}`);
	process.exitCode = 1;
});
