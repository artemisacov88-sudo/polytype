import { createHash } from "node:crypto";
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
	...["ru", "de", "ro"].flatMap((language) => [
		`data/multilingual/${language}/words.json`,
		`data/multilingual/${language}/manifest.json`,
		`data/multilingual/${language}/binary/model.ptng`,
		`data/multilingual/${language}/binary/context-stats.ptgs`,
		`data/multilingual/${language}/ATTRIBUTION.txt`,
	]),
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

	for (const language of ["ru", "de", "ro"]) {
		const base = `data/multilingual/${language}`;
		const dictionary = JSON.parse(await readFile(resolve(root, `${base}/words.json`), "utf8"));
		if (!Array.isArray(dictionary) || dictionary.length === 0 || !dictionary.every((entry) =>
			typeof entry.word === "string" && typeof entry.frequency === "number" && entry.frequency > 0
			&& typeof entry.pos === "string")) {
			throw new Error(`${base}/words.json has an invalid dictionary structure`);
		}
		const model = JSON.parse(await readFile(resolve(root, `${base}/manifest.json`), "utf8"));
		if (model.language !== language || model.data_license !== "CC BY 2.0 FR"
			|| model.source_corpus !== "Tatoeba" || model.attribution_file !== "ATTRIBUTION.txt") {
			throw new Error(`${base}/manifest.json has invalid language or attribution metadata`);
		}
		await verifyAsset(`${base}/words.json`, model.dictionary_bytes, model.dictionary_sha256);
		await verifyAsset(`${base}/binary/model.ptng`, model.binary_bytes, model.binary_sha256);
		await verifyAsset(`${base}/${model.context_statistics_file}`, model.context_statistics_bytes,
			model.context_statistics_sha256);
		const attribution = await readFile(resolve(root, `${base}/ATTRIBUTION.txt`), "utf8");
		if (!attribution.includes("Tatoeba") || !attribution.includes("CC BY 2.0 FR")
			|| !attribution.includes("Contributors")) {
			throw new Error(`${base}/ATTRIBUTION.txt is missing source/license/contributor credits`);
		}
	}

	console.log("Production package verified:");
	for (const relativePath of requiredFiles) {
		const { size } = await stat(resolve(root, relativePath));
		console.log(`  ${relativePath} (${(size / 1024).toFixed(1)} KiB)`);
	}
}

async function verifyAsset(relativePath, expectedBytes, expectedSha256) {
	if (typeof relativePath !== "string" || !Number.isSafeInteger(expectedBytes)
		|| typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
		throw new Error(`Model manifest has invalid integrity metadata for ${relativePath}`);
	}
	const bytes = await readFile(resolve(root, relativePath));
	const hash = createHash("sha256").update(bytes).digest("hex");
	if (bytes.byteLength !== expectedBytes || hash !== expectedSha256.toLowerCase()) {
		throw new Error(`${relativePath} does not match its manifest size or SHA-256`);
	}
}

void main().catch((error) => {
	console.error(`[PolyType] ${error.message}`);
	process.exitCode = 1;
});
