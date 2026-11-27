import assert from "node:assert/strict";
import { PersonalLearningService } from "../personal-learning/learning-service";
import { PersonalModel } from "../personal-learning/personal-model";
import { MAX_PERSONAL_MODEL_FILE_BYTES, PersonalModelStorage, type PersonalModelAdapter } from "../personal-learning/storage";

class MemoryAdapter implements PersonalModelAdapter {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>();
	failWrite = false;
	partialWrite = false;
	writeAttempts = 0;

	async exists(path: string): Promise<boolean> {
		return this.directories.has(path) || this.files.has(path);
	}
	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		return {
			files: [...this.files.keys()].filter((file) => file.startsWith(`${path}/`)
				&& !file.slice(path.length + 1).includes("/")),
			folders: [...this.directories].filter((folder) => folder.startsWith(`${path}/`)
				&& !folder.slice(path.length + 1).includes("/")),
		};
	}
	async mkdir(path: string): Promise<void> { this.directories.add(path); }
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing ${path}`);
		return value;
	}
	async write(path: string, data: string): Promise<void> {
		this.writeAttempts++;
		if (this.partialWrite) {
			this.files.set(path, data.slice(0, Math.max(1, Math.floor(data.length / 2))));
			throw new Error("simulated partial write failure");
		}
		if (this.failWrite) throw new Error("simulated write failure");
		this.files.set(path, data);
	}
	async remove(path: string): Promise<void> { this.files.delete(path); }
}

async function run(): Promise<void> {
	const adapter = new MemoryAdapter();
	const storage = new PersonalModelStorage(adapter, ".obsidian/plugins/polytype-personal-data");
	const initial = await storage.load();
	assert.equal(initial.fileBytes, 0);
	const model = initial.model;
	model.registerAcceptedSuggestion("tea", ["drink"], "en", "notes/a.md");
	const firstBytes = await storage.save(model);
	assert.ok(firstBytes > 0);
	model.registerAcceptedSuggestion("coffee", ["prefer"], "en", "notes/a.md");
	await storage.save(model);
	assert.equal(adapter.files.size, 2, "two generations are retained for recovery");

	const savedPaths = [...adapter.files.keys()].sort();
	const newestPath = savedPaths[savedPaths.length - 1];
	const newest = JSON.parse(adapter.files.get(newestPath)!);
	newest.checksum = "0".repeat(64);
	adapter.files.set(newestPath, JSON.stringify(newest));
	const recovered = await new PersonalModelStorage(adapter, ".obsidian/plugins/polytype-personal-data").load();
	assert.equal(recovered.recoveredFromPreviousGeneration, true);
	assert.equal(recovered.model.getStatistics().acceptedSuggestions, 1);
	assert.equal(recovered.model.getStatistics().unigrams.get("tea"), 1);

	const failingAdapter = new MemoryAdapter();
	const failingStorage = new PersonalModelStorage(failingAdapter, "personal-data");
	await failingStorage.load();
	failingAdapter.failWrite = true;
	await assert.rejects(() => failingStorage.save(model), /simulated write failure/);
	assert.equal(failingAdapter.files.size, 0, "a failed write leaves no partial generation");

	const unknownAdapter = new MemoryAdapter();
	unknownAdapter.directories.add("personal-data");
	unknownAdapter.files.set("personal-data/model-v2.json", "keep me");
	await assert.rejects(() => new PersonalModelStorage(unknownAdapter, "personal-data").load(), /unknown files or folders/);
	assert.equal(unknownAdapter.files.get("personal-data/model-v2.json"), "keep me",
		"unknown-format files are preserved");

	const incompatibleAdapter = new MemoryAdapter();
	const incompatibleStorage = new PersonalModelStorage(incompatibleAdapter, "personal-data");
	await incompatibleStorage.load();
	const incompatibleModel = new PersonalModel();
	incompatibleModel.registerAcceptedSuggestion("tea", [], "en", "notes/a.md");
	await incompatibleStorage.save(incompatibleModel);
	const incompatiblePath = [...incompatibleAdapter.files.keys()][0];
	const incompatibleEnvelope = JSON.parse(incompatibleAdapter.files.get(incompatiblePath)!);
	incompatibleEnvelope.modelVersion = 99;
	incompatibleAdapter.files.set(incompatiblePath, JSON.stringify(incompatibleEnvelope));
	await assert.rejects(() => new PersonalModelStorage(incompatibleAdapter, "personal-data").load(),
		/unsupported version/);
	assert.ok(incompatibleAdapter.files.has(incompatiblePath), "incompatible user data is not deleted or overwritten");

	const partialAdapter = new MemoryAdapter();
	const partialStorage = new PersonalModelStorage(partialAdapter, "personal-data");
	await partialStorage.load();
	const recoverableModel = new PersonalModel();
	recoverableModel.registerAcceptedSuggestion("tea", [], "en", "notes/a.md");
	await partialStorage.save(recoverableModel);
	recoverableModel.registerAcceptedSuggestion("coffee", [], "en", "notes/a.md");
	partialAdapter.partialWrite = true;
	await assert.rejects(() => partialStorage.save(recoverableModel), /partial write failure/);
	partialAdapter.partialWrite = false;
	const afterPartialWrite = await new PersonalModelStorage(partialAdapter, "personal-data").load();
	assert.equal(afterPartialWrite.recoveredFromPreviousGeneration, true);
	assert.equal(afterPartialWrite.model.getStatistics().acceptedSuggestions, 1,
		"partial generation is rejected and previous checksum-valid generation is recovered");

	const oversizedAdapter = new MemoryAdapter();
	const oversizedStorage = new PersonalModelStorage(oversizedAdapter, "personal-data");
	await oversizedStorage.load();
	const oversizedModel = {
		toJSON: () => ({ version: 1, language: "en", notes: [{ data: "x".repeat(MAX_PERSONAL_MODEL_FILE_BYTES) }] }),
	} as unknown as PersonalModel;
	await assert.rejects(() => oversizedStorage.save(oversizedModel), /storage limit/);
	assert.equal(oversizedAdapter.files.size, 0, "oversized data is rejected before writing");

	const retryAdapter = new MemoryAdapter();
	const notices: string[] = [];
	const service = new PersonalLearningService(
		new PersonalModelStorage(retryAdapter, "personal-data"),
		(message) => notices.push(message),
		60_000,
		1,
		2,
	);
	await service.load();
	service.setPreferences(true, []);
	assert.equal(service.recordAcceptedSuggestion("tea", [], "en", "notes/a.md"), true);
	retryAdapter.failWrite = true;
	await assert.rejects(() => service.flush(), /simulated write failure/);
	for (let attempt = 0; attempt < 50 && retryAdapter.writeAttempts < 3; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	assert.equal(retryAdapter.writeAttempts, 3, "automatic retries stop after the configured limit");
	assert.equal(notices.filter((message) => message.startsWith("Could not save")).length, 1,
		"repeated automatic retries with the same error do not repeat notices");
	assert.equal(service.getStatus().dirty, true, "failed writes retain dirty in-memory data");
	retryAdapter.failWrite = false;
	await service.retrySave();
	assert.equal(service.getStatus().dirty, false, "a later retry clears dirty state");
	await service.reset();
	await service.dispose();

	const loadingAdapter = new MemoryAdapter();
	const loadingStorage = new PersonalModelStorage(loadingAdapter, "loading-race");
	const loadingService = new PersonalLearningService(loadingStorage);
	let signalLoadStart!: () => void;
	let releaseLoad!: () => void;
	const loadStarted = new Promise<void>((resolve) => { signalLoadStart = resolve; });
	const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
	const originalExists = loadingAdapter.exists.bind(loadingAdapter);
	let firstExists = true;
	loadingAdapter.exists = async (path) => {
		if (firstExists) {
			firstExists = false;
			signalLoadStart();
			await loadGate;
		}
		return originalExists(path);
	};
	const loadingPromise = loadingService.load();
	await loadStarted;
	let resetFinished = false;
	const resetPromise = loadingService.reset().then(() => { resetFinished = true; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(resetFinished, false, "reset waits for the initial storage load to finish");
	releaseLoad();
	await Promise.all([loadingPromise, resetPromise]);
	assert.equal(loadingService.getStatus().acceptedSuggestions, 0,
		"a load finishing concurrently with reset cannot restore stale in-memory data");
	await loadingService.dispose();

	const exitAdapter = new MemoryAdapter();
	const exitService = new PersonalLearningService(new PersonalModelStorage(exitAdapter, "personal-data"));
	await exitService.load();
	exitService.setPreferences(true, []);
	assert.equal(exitService.recordAcceptedSuggestion("final", [], "en", "notes/a.md"), true);
	await exitService.dispose();
	assert.equal(exitAdapter.files.size, 1, "disposal performs a final awaited save attempt");

	adapter.files.set(".obsidian/plugins/polytype-personal-data/user-file.txt", "preserve on reset");
	await storage.reset();
	assert.equal(adapter.files.size, 1);
	assert.equal(adapter.files.get(".obsidian/plugins/polytype-personal-data/user-file.txt"), "preserve on reset",
		"reset preserves files that do not belong to a known model generation");
	console.log("Personal storage tests passed.");
}

void run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
