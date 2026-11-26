import assert from "node:assert/strict";
import { LatestSuggestionRequests } from "../ui/latest-suggestion-requests";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function staleLanguageResponse(oldLanguage: string, newLanguage: string): Promise<void> {
	const requests = new LatestSuggestionRequests<string>();
	const oldResponse = deferred<readonly string[]>();
	const newResponse = deferred<readonly string[]>();
	let visible: readonly string[] = [];
	const commit = (promise: Promise<readonly string[]>) => promise.then((items) => { visible = items; });

	const oldRequest = requests.request(() => oldResponse.promise);
	const oldCommit = commit(oldRequest);
	const newRequest = requests.request(() => newResponse.promise);
	const newCommit = commit(newRequest);

	newResponse.resolve([`${newLanguage}-result`]);
	await newCommit;
	assert.deepEqual(visible, [`${newLanguage}-result`], `${oldLanguage} → ${newLanguage}: newer response appears first`);
	oldResponse.resolve([`${oldLanguage}-result`]);
	await oldCommit;
	assert.deepEqual(visible, [`${newLanguage}-result`], `${oldLanguage} → ${newLanguage}: late response cannot replace newer results`);
}

async function repeatedLanguageResponse(): Promise<void> {
	const requests = new LatestSuggestionRequests<string>();
	const oldResponse = deferred<readonly string[]>();
	const newResponse = deferred<readonly string[]>();
	let visible: readonly string[] = [];
	const commit = (promise: Promise<readonly string[]>) => promise.then((items) => { visible = items; });

	const olderQuery = requests.request(() => oldResponse.promise);
	const olderCommit = commit(olderQuery);
	const newerQuery = requests.request(() => newResponse.promise);
	const newerCommit = commit(newerQuery);
	newResponse.resolve(["RO-new-query"]);
	await newerCommit;
	oldResponse.resolve(["RO-old-query"]);
	await olderCommit;
	assert.deepEqual(visible, ["RO-new-query"], "a late response for the same language cannot replace the newer query");
}

async function confirmsUnguardedRace(): Promise<void> {
	const oldResponse = deferred<readonly string[]>();
	const newResponse = deferred<readonly string[]>();
	let visible: readonly string[] = [];
	// Mirrors the former getSuggestions behavior: each invocation returned its own provider result.
	const oldRequest = oldResponse.promise.then((items) => { visible = items; });
	const newRequest = newResponse.promise.then((items) => { visible = items; });
	newResponse.resolve(["RO-result"]);
	await newRequest;
	oldResponse.resolve(["DE-result"]);
	await oldRequest;
	assert.deepEqual(visible, ["DE-result"], "the unguarded completion order reproduces the stale-result race");
}

async function main(): Promise<void> {
	await confirmsUnguardedRace();
	await staleLanguageResponse("DE", "RO");
	await staleLanguageResponse("RO", "DE");
	await repeatedLanguageResponse();
	console.log("Latest suggestion response tests passed (DE → RO, RO → DE, repeated language).");
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
