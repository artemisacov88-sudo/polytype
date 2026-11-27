import type { LanguageId } from "../language/types";
import { normalizeSpellingSurface } from "./normalization";

export type PersonalDictionaryScope = "global" | "note";

export interface PersonalDictionaryEntry {
	word: string;
	language: LanguageId;
	scope: PersonalDictionaryScope;
	notePath?: string;
}

export interface PersonalDictionaryData {
	envelopeVersion: 1;
	entries: readonly PersonalDictionaryEntry[];
}

export interface PersonalDictionaryAdapter {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
}

export class PersonalSpellingDictionary {
	private entries: PersonalDictionaryEntry[] = [];
	private revision = 0;
	private readonly directory: string;
	private readonly filePath: string;

	constructor(
		private readonly adapter: PersonalDictionaryAdapter,
		directory: string,
	) {
		this.directory = directory.replace(/\/+$/, "");
		this.filePath = `${this.directory}/personal-dictionary-v1.json`;
	}

	async load(): Promise<void> {
		if (!(await this.adapter.exists(this.directory))) return;
		const content = await this.adapter.read(this.filePath);
		const value = JSON.parse(content) as unknown;
		if (!isDictionaryData(value)) throw new Error("Personal spelling dictionary is malformed");
		this.entries = [...value.entries];
		this.revision++;
	}

	async add(word: string, language: LanguageId, scope: PersonalDictionaryScope = "global", notePath?: string): Promise<void> {
		const normalizedWord = normalizeSpellingSurface(word, language).searchForm;
		if (!normalizedWord) return;
		const existing = this.entries.find((entry) => entry.language === language
			&& entry.word === normalizedWord
			&& entry.scope === scope
			&& (scope === "global" || entry.notePath === notePath));
		if (existing) return;
		this.entries.push({ word: normalizedWord, language, scope, notePath });
		this.revision++;
		await this.save();
	}

	async remove(word: string, language: LanguageId, scope: PersonalDictionaryScope = "global", notePath?: string): Promise<void> {
		const normalizedWord = normalizeSpellingSurface(word, language).searchForm;
		const before = this.entries.length;
		this.entries = this.entries.filter((entry) => !(entry.language === language
			&& entry.word === normalizedWord
			&& entry.scope === scope
			&& (scope === "global" || entry.notePath === notePath)));
		if (this.entries.length !== before) {
			this.revision++;
			await this.save();
		}
	}

	getRevision(): number {
		return this.revision;
	}

	isAllowed(word: string, language: LanguageId, notePath?: string): boolean {
		const normalizedWord = normalizeSpellingSurface(word, language).searchForm;
		return this.entries.some((entry) => entry.language === language
			&& entry.word === normalizedWord
			&& (entry.scope === "global" || entry.notePath === notePath));
	}

	isIgnored(word: string, language: LanguageId, notePath?: string): boolean {
		return this.isAllowed(word, language, notePath);
	}

	getEntries(): readonly PersonalDictionaryEntry[] {
		return [...this.entries];
	}

	private async save(): Promise<void> {
		if (!(await this.adapter.exists(this.directory))) await this.adapter.mkdir(this.directory);
		const data: PersonalDictionaryData = { envelopeVersion: 1, entries: this.entries };
		await this.adapter.write(this.filePath, JSON.stringify(data));
	}
}

function isDictionaryData(value: unknown): value is PersonalDictionaryData {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.envelopeVersion === 1
		&& Array.isArray(record.entries)
		&& record.entries.every((entry: unknown) => {
			if (!entry || typeof entry !== "object") return false;
			const item = entry as Record<string, unknown>;
			return typeof item.word === "string"
				&& ["ru", "en", "de", "ro"].includes(String(item.language))
				&& (item.scope === "global" || item.scope === "note");
		});
}
