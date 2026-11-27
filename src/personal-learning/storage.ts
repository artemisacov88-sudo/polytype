import {
	PersonalModel,
	PERSONAL_MODEL_VERSION,
	type SerializedPersonalModel,
} from "./personal-model";

export const PERSONAL_MODEL_DIRECTORY = "personal-learning";
export const MAX_PERSONAL_MODEL_FILE_BYTES = 5 * 1024 * 1024;
const MODEL_FILE_PATTERN = /(?:^|\/)model-v1-(\d+)\.json$/;
const ENVELOPE_VERSION = 1;

export interface PersonalModelAdapter {
	exists(path: string): Promise<boolean>;
	stat?(path: string): Promise<{ size: number } | null>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	mkdir(path: string): Promise<void>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface PersonalModelLoadResult {
	model: PersonalModel;
	fileBytes: number;
	generation: number;
	recoveredFromPreviousGeneration: boolean;
}

interface PersonalModelEnvelope {
	envelopeVersion: typeof ENVELOPE_VERSION;
	modelVersion: typeof PERSONAL_MODEL_VERSION;
	savedAt: number;
	checksum: string;
	model: SerializedPersonalModel;
}

/** Versioned, checksummed, rotating local files. No Obsidian API is required. */
export class PersonalModelStorage {
	private generation = 0;
	private loaded = false;

	constructor(private readonly adapter: PersonalModelAdapter, private readonly directory: string) {}

	async load(): Promise<PersonalModelLoadResult> {
		if (!(await this.adapter.exists(this.directory))) {
			this.loaded = true;
			this.generation = 0;
			return { model: new PersonalModel(), fileBytes: 0, generation: 0,
				recoveredFromPreviousGeneration: false };
		}
		const { files, folders } = await this.adapter.list(this.directory);
		const candidates = files
			.map((path) => ({ path, match: path.match(MODEL_FILE_PATTERN) }))
			.filter((item): item is { path: string; match: RegExpMatchArray } => item.match !== null)
			.map((item) => ({ path: item.path, generation: Number(item.match[1]) }))
			.sort((left, right) => right.generation - left.generation);
		if (candidates.length === 0) {
			if (files.length > 0 || folders.length > 0) {
				throw new Error("Personal model directory contains unknown files or folders; data was left untouched");
			}
			this.loaded = true;
			this.generation = 0;
			return { model: new PersonalModel(), fileBytes: 0, generation: 0,
				recoveredFromPreviousGeneration: false };
		}

		let mostRecentError: unknown;
		for (let index = 0; index < candidates.length; index++) {
			const candidate = candidates[index];
			try {
				const stat = await this.adapter.stat?.(candidate.path);
				if (stat && stat.size > MAX_PERSONAL_MODEL_FILE_BYTES) {
					throw new Error("Personal model file exceeds the size limit");
				}
				const content = await this.adapter.read(candidate.path);
				const bytes = new TextEncoder().encode(content).byteLength;
				if (bytes > MAX_PERSONAL_MODEL_FILE_BYTES) throw new Error("Personal model file exceeds the size limit");
				const model = await decodeEnvelope(content);
				this.generation = candidate.generation;
				this.loaded = true;
				return { model, fileBytes: bytes, generation: candidate.generation,
					recoveredFromPreviousGeneration: index > 0 };
			} catch (error) {
				mostRecentError = error;
			}
		}
		throw new Error(`No valid personal model generation could be loaded: ${describe(mostRecentError)}`);
	}

	async save(model: PersonalModel): Promise<number> {
		if (!this.loaded) throw new Error("Personal model storage must be loaded before saving");
		const serializedModel = model.toJSON();
		const modelJson = JSON.stringify(serializedModel);
		const checksum = await sha256(modelJson);
		const envelope: PersonalModelEnvelope = {
			envelopeVersion: ENVELOPE_VERSION,
			modelVersion: PERSONAL_MODEL_VERSION,
			savedAt: Date.now(),
			checksum,
			model: serializedModel,
		};
		const content = JSON.stringify(envelope);
		const bytes = new TextEncoder().encode(content).byteLength;
		if (bytes > MAX_PERSONAL_MODEL_FILE_BYTES) {
			throw new Error(`Personal model reached the ${MAX_PERSONAL_MODEL_FILE_BYTES} byte storage limit`);
		}
		if (!(await this.adapter.exists(this.directory))) await this.adapter.mkdir(this.directory);

		let nextGeneration = this.generation + 1;
		let nextPath = `${this.directory}/model-v1-${String(nextGeneration).padStart(8, "0")}.json`;
		while (await this.adapter.exists(nextPath)) {
			nextGeneration++;
			nextPath = `${this.directory}/model-v1-${String(nextGeneration).padStart(8, "0")}.json`;
		}
		await this.adapter.write(nextPath, content);
		// Verify the completed generation before allowing cleanup of older files.
		await verifyEnvelope(await this.adapter.read(nextPath));
		this.generation = nextGeneration;
		const { files } = await this.adapter.list(this.directory);
		const oldGenerations = files
			.map((path) => ({ path, match: path.match(MODEL_FILE_PATTERN) }))
			.filter((item): item is { path: string; match: RegExpMatchArray } => item.match !== null)
			.map((item) => ({ path: item.path, generation: Number(item.match[1]) }))
			.sort((left, right) => right.generation - left.generation)
			.slice(2);
		for (const old of oldGenerations) await this.adapter.remove(old.path);
		return bytes;
	}

	async reset(): Promise<void> {
		if (await this.adapter.exists(this.directory)) {
			const { files } = await this.adapter.list(this.directory);
			for (const path of files) if (MODEL_FILE_PATTERN.test(path)) await this.adapter.remove(path);
		}
		this.generation = 0;
		this.loaded = true;
	}
}

async function decodeEnvelope(content: string): Promise<PersonalModel> {
	return PersonalModel.fromJSON(await verifyEnvelope(content));
}

async function verifyEnvelope(content: string): Promise<unknown> {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch (error) {
		throw new Error(`Personal model JSON is invalid: ${describe(error)}`);
	}
	if (!isRecord(value) || value.envelopeVersion !== ENVELOPE_VERSION
		|| value.modelVersion !== PERSONAL_MODEL_VERSION || !isRecord(value.model)
		|| typeof value.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(value.checksum)
		|| typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) {
		throw new Error("Personal model envelope is malformed or uses an unsupported version");
	}
	const actualChecksum = await sha256(JSON.stringify(value.model));
	if (actualChecksum !== value.checksum.toLowerCase()) throw new Error("Personal model checksum does not match");
	return value.model;
}

async function sha256(value: string): Promise<string> {
	if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this runtime");
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
