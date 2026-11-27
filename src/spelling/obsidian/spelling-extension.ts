import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	hoverTooltip,
	ViewPlugin,
	type DecorationSet,
	type Tooltip,
	type ViewUpdate,
} from "@codemirror/view";
import type { PolyTypeSettings } from "../../settings";
import { resolveLanguage } from "../../language/detector";
import { SpellingEngine } from "../spelling-engine";
import { PersonalSpellingDictionary } from "../personal-dictionary";
import type { SpellingIssue } from "../spelling-types";

export const setSpellingDecorations = StateEffect.define<readonly DecorationRange[]>();
export const replaceSpellingRange = StateEffect.define<{ from: number; to: number; ranges: readonly DecorationRange[] }>();
export const clearSpellingDecorations = StateEffect.define<null>();

interface DecorationRange {
	from: number;
	to: number;
	issue: SpellingIssue;
}

export const spellingDecorationField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update: (value, transaction) => {
		let next = value.map(transaction.changes);
		for (const effect of transaction.effects) {
			if (effect.is(clearSpellingDecorations)) next = Decoration.none;
			if (effect.is(replaceSpellingRange)) {
				const keep: Array<{ from: number; to: number; value: Decoration }> = [];
				next.between(0, transaction.state.doc.length, (from, to, decoration) => {
					if (from >= effect.value.to || to <= effect.value.from) {
						keep.push({ from, to, value: Decoration.mark(decoration.spec) });
					}
				});
				const replacements = effect.value.ranges.map(({ from, to, issue }) =>
					Decoration.mark({
						class: "polytype-spelling-error",
						attributes: {
							"data-polytype-spelling": issue.word.searchForm,
							"data-polytype-issue": encodeURIComponent(JSON.stringify(issue)),
						},
					}).range(from, to));
				next = Decoration.set([...keep, ...replacements], true);
			}
			if (effect.is(setSpellingDecorations)) {
				const replacements = effect.value.map(({ from, to, issue }) =>
					Decoration.mark({
						class: "polytype-spelling-error",
						attributes: {
							"data-polytype-spelling": issue.word.searchForm,
							"data-polytype-issue": encodeURIComponent(JSON.stringify(issue)),
						},
					}).range(from, to));
				next = Decoration.set(replacements, true);
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

export function createSpellingExtension(
	getSettings: () => PolyTypeSettings,
	engine: SpellingEngine,
	personalDictionary: PersonalSpellingDictionary,
): ExtensionBundle {
	const tooltip = hoverTooltip((view, position) => findTooltip(view, position, getSettings, personalDictionary));
	const plugin = ViewPlugin.define((view) => new SpellingView(view, getSettings, engine));
	return { tooltip, plugin, field: spellingDecorationField };
}

interface ExtensionBundle {
	tooltip: ReturnType<typeof hoverTooltip>;
	plugin: Extension;
	field: typeof spellingDecorationField;
}

class SpellingView {
	timer: ReturnType<typeof setTimeout> | undefined;
	backgroundTimer: ReturnType<typeof setTimeout> | undefined;
	generation = 0;

	constructor(
		private readonly view: EditorView,
		private readonly getSettings: () => PolyTypeSettings,
		private readonly engine: SpellingEngine,
	) {
		this.scheduleVisible();
	}

	update(update: ViewUpdate): void {
		if (update.docChanged) {
			this.generation++;
			if (this.timer) clearTimeout(this.timer);
			if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
			this.timer = setTimeout(() => {
				void this.checkVisibleRanges(update.state.doc.toString(), this.generation);
			}, 220);
		} else if (update.viewportChanged) {
			this.scheduleVisible();
		}
	}

	destroy(): void {
		if (this.timer) clearTimeout(this.timer);
		if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
		this.generation++;
	}

	private scheduleVisible(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			void this.checkVisibleRanges(this.view.state.doc.toString(), this.generation);
		}, 220);
	}

	private async checkVisibleRanges(text: string, generation: number): Promise<void> {
		const settings = this.getSettings();
		if (!settings.spellingCheckEnabled || !settings.spellingUnderlineEnabled) {
			this.view.dispatch({ effects: clearSpellingDecorations.of(null) });
			return;
		}
		const visibleRanges = this.view.visibleRanges;
		for (const range of visibleRanges) {
			await this.checkRange(range.from, range.to, text, settings, generation);
		}
		if (generation !== this.generation) return;
		this.scheduleBackground(text, visibleRanges, settings, generation);
	}

	private async checkRange(
		from: number,
		to: number,
		text: string,
		settings: PolyTypeSettings,
		generation: number,
	): Promise<void> {
		if (generation !== this.generation) return;
		const fragment = text.slice(from, to);
		const hint = resolveLanguage(fragment, settings.language, settings.languageMode);
		const result = await this.engine.checkText(fragment, hint, from);
		if (generation !== this.generation) return;
		const ranges: DecorationRange[] = result.issues.map((issue) => ({
			from: issue.word.from,
			to: issue.word.to,
			issue,
		}));
		this.view.dispatch({
			effects: replaceSpellingRange.of({ from, to, ranges }),
		});
	}

	private scheduleBackground(
		text: string,
		visibleRanges: readonly { from: number; to: number }[],
		settings: PolyTypeSettings,
		generation: number,
	): void {
		if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
		this.backgroundTimer = setTimeout(() => {
			void this.checkBackground(text, visibleRanges, settings, generation);
		}, 400);
	}

	private async checkBackground(
		text: string,
		visibleRanges: readonly { from: number; to: number }[],
		settings: PolyTypeSettings,
		generation: number,
	): Promise<void> {
		const BLOCK_SIZE = 4000;
		let cursor = 0;
		const isVisible = (from: number, to: number) =>
			visibleRanges.some((range) => from < range.to && to > range.from);
		while (cursor < text.length) {
			if (generation !== this.generation) return;
			const to = Math.min(text.length, cursor + BLOCK_SIZE);
			if (!isVisible(cursor, to)) {
				await this.checkRange(cursor, to, text, settings, generation);
			}
			cursor = to;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}
}

export function findTooltip(
	view: Pick<EditorView, "state" | "dispatch">,
	position: number,
	getSettings: () => PolyTypeSettings,
	personalDictionary: PersonalSpellingDictionary,
): Tooltip | null {
	const field = view.state.field(spellingDecorationField, false);
	if (!field) return null;
	let found: SpellingIssue | undefined;
	field.between(position - 1, position + 1, (_from, _to, decoration) => {
		const serialized = decoration.spec.attributes?.["data-polytype-issue"];
		if (!serialized) return;
		try {
			found = JSON.parse(decodeURIComponent(serialized)) as SpellingIssue;
		} catch {
			found = undefined;
		}
	});
	if (!found) return null;

	const issue = found;
	return {
		pos: issue.word.from,
		end: issue.word.to,
		above: true,
		create: () => {
			const dom = document.createElement("div");
			dom.className = "polytype-spelling-tooltip";
			if (issue.candidates.length === 0) dom.textContent = getSettings().language;
			for (const candidate of issue.candidates) {
				const button = dom.createEl("button", { text: candidate.word });
				button.addEventListener("click", () => {
					view.dispatch({
						changes: { from: issue.word.from, to: issue.word.to, insert: candidate.word },
					});
				});
			}
			const ignore = dom.createEl("button", { text: "Ignore" });
			ignore.addEventListener("click", () => {
				const language = issue.word.language ?? getSettings().language;
				void personalDictionary.add(issue.word.surfaceForm, language, "global");
				view.dispatch({
					effects: replaceSpellingRange.of({
						from: issue.word.from,
						to: issue.word.to,
						ranges: [],
					}),
				});
			});
			return { dom };
		},
	};
}
