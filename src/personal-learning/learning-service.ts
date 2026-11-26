import { matchesExcludedPath } from "./eligibility";
import { PersonalModel } from "./personal-model";
import { PersonalModelStorage } from "./storage";

export interface PersonalLearningStatus {
	loaded: boolean;
	enabled: boolean;
	dirty: boolean;
	fileBytes: number;
	error?: string;
	acceptedSuggestions: number;
	typedWords: number;
	wordTypes: number;
	bigramTypes: number;
	trigramTypes: number;
	notes: number;
}

/** Owns the in-memory model lifecycle and batches local writes. */
export class PersonalLearningService {
	model = new PersonalModel();
	private loaded = false;
	private loadPromise: Promise<void> | undefined;
	private enabled = false;
	private dirty = false;
	private revision = 0;
	private fileBytes = 0;
	private lastError: string | undefined;
	private excludedPaths: string[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private writeQueue: Promise<void> = Promise.resolve();
	private disposed = false;
	private warnedAtCapacity = false;
	private lastReportedSaveError: string | undefined;
	private automaticRetryAttempts = 0;

	constructor(
		private readonly storage: PersonalModelStorage,
		private readonly onStatus: (message: string) => void = () => undefined,
		private readonly saveDelayMs = 1500,
		private readonly retryDelayMs = 5000,
		private readonly maximumAutomaticRetries = 3,
	) {}

	load(): Promise<void> {
		if (!this.loadPromise) this.loadPromise = this.loadFromStorage();
		return this.loadPromise;
	}

	private async loadFromStorage(): Promise<void> {
		const result = await this.storage.load();
		this.model = result.model;
		this.fileBytes = result.fileBytes;
		this.loaded = true;
		this.lastError = undefined;
		if (result.recoveredFromPreviousGeneration) {
			this.report("Personal learning recovered from its previous local save.");
			this.markDirty();
		}
	}

	setPreferences(enabled: boolean, excludedPaths: readonly string[]): void {
		this.enabled = enabled;
		this.excludedPaths = excludedPaths.filter((path) => typeof path === "string" && path.trim().length > 0)
			.map((path) => path.trim());
		for (const notePath of this.model.getNotePaths()) {
			if (this.isPathExcluded(notePath) && this.model.excludeNote(notePath)) this.markDirty();
		}
	}

	get isReady(): boolean {
		return this.loaded;
	}

	get isEnabled(): boolean {
		return this.enabled && this.loaded && !this.disposed;
	}

	getStatus(): PersonalLearningStatus {
		return {
			loaded: this.loaded,
			enabled: this.isEnabled,
			dirty: this.dirty,
			fileBytes: this.fileBytes,
			error: this.lastError,
			...this.model.getUsage(),
		};
	}

	recordAcceptedSuggestion(word: string, context: readonly string[], language: string, notePath: string): boolean {
		return this.recordObservation(word, context, language, notePath, "accepted");
	}

	recordTypedWord(word: string, context: readonly string[], language: string, notePath: string): boolean {
		return this.recordObservation(word, context, language, notePath, "typed");
	}

	private recordObservation(
		word: string,
		context: readonly string[],
		language: string,
		notePath: string,
		source: "accepted" | "typed",
	): boolean {
		if (!this.isEnabled || language !== "en" || this.isPathExcluded(notePath)) return false;
		const accepted = source === "accepted"
			? this.model.registerAcceptedSuggestion(word, context, language, notePath)
			: this.model.registerTypedWord(word, context, language, notePath);
		if (!accepted) {
			if (!this.warnedAtCapacity) {
				this.warnedAtCapacity = true;
				this.report("Personal learning reached its local size limit; reset the model to continue learning.");
			}
			return false;
		}
		this.warnedAtCapacity = false;
		this.markDirty();
		return true;
	}

	deleteNote(notePath: string): void {
		if (this.model.excludeNote(notePath)) this.markDirty();
	}

	forgetPath(path: string): void {
		let changed = false;
		for (const notePath of this.model.getNotePaths()) {
			if (matchesExcludedPath(notePath, path)) changed = this.model.excludeNote(notePath) || changed;
		}
		if (changed) this.markDirty();
	}

	renameNote(oldPath: string, newPath: string): void {
		if (oldPath === newPath) return;
		if (this.isPathExcluded(newPath)) this.deleteNote(oldPath);
		else if (this.model.renameNote(oldPath, newPath)) this.markDirty();
	}

	renamePath(oldPath: string, newPath: string): void {
		const trackedPaths = this.model.getNotePaths().filter((path) => matchesExcludedPath(path, oldPath));
		let changed = false;
		for (const path of trackedPaths) {
			const nextPath = path === oldPath ? newPath : `${newPath}${path.slice(oldPath.length)}`;
			if (this.isPathExcluded(nextPath)) this.model.excludeNote(path);
			else this.model.renameNote(path, nextPath);
			changed = true;
		}
		if (changed) this.markDirty();
	}

	async reset(): Promise<void> {
		// A user may invoke Reset while the initial asynchronous load is still
		// running. Wait for it first so a late load cannot restore the old model
		// into memory after reset has completed.
		await this.loadPromise?.catch(() => undefined);
		this.clearSaveTimer();
		await this.writeQueue.catch(() => undefined);
		await this.storage.reset();
		this.model = new PersonalModel();
		this.loaded = true;
		this.fileBytes = 0;
		this.lastError = undefined;
		this.lastReportedSaveError = undefined;
		this.dirty = false;
		this.revision = 0;
		this.warnedAtCapacity = false;
		this.automaticRetryAttempts = 0;
		this.loadPromise = Promise.resolve();
	}

	async flush(): Promise<void> {
		this.clearSaveTimer();
		if (!this.loaded || !this.dirty || this.disposed) return this.writeQueue;
		this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
			if (!this.dirty) return;
			const savedRevision = this.revision;
			try {
				this.fileBytes = await this.storage.save(this.model);
				this.dirty = this.revision !== savedRevision;
				this.lastError = undefined;
				this.lastReportedSaveError = undefined;
				this.automaticRetryAttempts = 0;
				if (this.dirty && !this.disposed) this.scheduleSave();
			} catch (error) {
				this.lastError = error instanceof Error ? error.message : String(error);
				this.automaticRetryAttempts++;
				if (this.lastReportedSaveError !== this.lastError) {
					this.lastReportedSaveError = this.lastError;
					this.report(`Could not save local personal learning data: ${this.lastError}`);
				}
				this.scheduleRetry();
				throw error;
			}
		});
		return this.writeQueue;
	}

	/** Attempts one final flush; callers can await this when their lifecycle permits. */
	dispose(): Promise<void> {
		this.clearSaveTimer();
		const finalFlush = this.loaded && this.dirty
			? this.flush().catch(() => undefined)
			: Promise.resolve();
		this.disposed = true;
		return finalFlush;
	}

	/** Explicit user initiated retry after automatic retries have been exhausted. */
	retrySave(): Promise<void> {
		if (!this.loaded || !this.dirty || this.disposed) return Promise.resolve();
		this.automaticRetryAttempts = 0;
		return this.flush();
	}

	private isPathExcluded(path: string): boolean {
		return this.excludedPaths.some((pattern) => matchesExcludedPath(path, pattern));
	}

	private markDirty(): void {
		this.revision++;
		this.dirty = true;
		if (this.loaded && !this.lastError) this.scheduleSave();
	}

	private scheduleSave(): void {
		this.clearSaveTimer();
		this.saveTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.saveDelayMs);
	}

	private scheduleRetry(): void {
		if (this.disposed || this.automaticRetryAttempts > this.maximumAutomaticRetries) return;
		this.clearSaveTimer();
		const delay = Math.min(60_000, Math.max(1, this.retryDelayMs) * 2 ** (this.automaticRetryAttempts - 1));
		this.saveTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, delay);
	}

	private clearSaveTimer(): void {
		if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
		this.saveTimer = undefined;
	}

	private report(message: string): void {
		try { this.onStatus(message); } catch { /* Status reporting must not interrupt learning. */ }
	}
}
