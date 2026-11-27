import type { CachedMetadata, TFile } from "obsidian";

export interface LearningLocation {
	file: TFile;
	cursorLine: number;
	cursorCh: number;
	lineText: string;
	textBeforeCursor?: string;
	metadata: CachedMetadata | null;
}

const DEFAULT_EXCLUDED_SEGMENTS = new Set([".obsidian", ".trash", ".git", "node_modules", "templates", "template"]);

/** True only for ordinary Markdown prose, outside cached code/YAML and inline code spans. */
export function isEligibleLearningLocation(
	location: LearningLocation,
	excludedPaths: readonly string[] = [],
): boolean {
	const path = location.file.path.replace(/\\/g, "/");
	if (!path.toLocaleLowerCase("en-US").endsWith(".md") || isDefaultExcludedPath(path)
		|| excludedPaths.some((excluded) => matchesExcludedPath(path, excluded))) return false;

	const line = location.cursorLine;
	const metadata = location.metadata;
	if (!metadata || !Array.isArray(metadata.sections)) return false;
	const frontmatter = metadata?.frontmatter?.position;
	if (frontmatter && line >= frontmatter.start.line && line <= frontmatter.end.line) return false;
	if (metadata?.sections?.some((section) => section.type === "yaml" || section.type === "code"
		|| section.type === "html"
		? line >= section.position.start.line && line <= section.position.end.line
		: false)) return false;
	// Only learn when Obsidian has positively classified the cursor line.
	if (!metadata.sections.some((section) => line >= section.position.start.line
		&& line <= section.position.end.line)) return false;

	const beforeCursor = location.lineText.slice(0, location.cursorCh);
	if (/^\s{0,3}(?:`{3,}|~{3,})/.test(beforeCursor)) return false;
	return !isInsideInlineCode(beforeCursor);
}

export function matchesExcludedPath(filePath: string, pattern: string): boolean {
	const normalizedPattern = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (!normalizedPattern) return false;
	const normalizedPath = filePath.replace(/\\/g, "/");
	return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
}

function isDefaultExcludedPath(path: string): boolean {
	return path.split("/").some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment.toLocaleLowerCase("en-US")));
}

function isInsideInlineCode(text: string): boolean {
	let openingRun = 0;
	for (let index = 0; index < text.length;) {
		if (text[index] !== "`") {
			index++;
			continue;
		}
		let precedingSlashes = 0;
		for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) precedingSlashes++;
		let end = index + 1;
		while (end < text.length && text[end] === "`") end++;
		const runLength = end - index;
		if (precedingSlashes % 2 === 0) {
			if (openingRun === 0) openingRun = runLength;
			else if (runLength === openingRun) openingRun = 0;
		}
		index = end;
	}
	return openingRun > 0;
}
