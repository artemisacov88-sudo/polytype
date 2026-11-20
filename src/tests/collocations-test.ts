import assert from "node:assert/strict";
import { findCollocationCandidates, type CollocationData } from "../prediction/collocations";

const data: CollocationData = {
	make: {
		VERB_noun_object: [
			{ word: "market", count: 4, score: 8 },
			{ word: "model", count: 3, score: 6 },
		],
		VERB_prep_after: [
			{ word: "market", count: 9, score: 10 },
		],
		ADJ_noun: [
			{ word: "material", count: 6, score: 7 },
		],
		NOUN_noun_before: [
			{ word: "mistaken", count: 99, score: 99 },
		],
	},
};

assert.deepEqual(
	findCollocationCandidates(data, "MAKE", "ma"),
	[
		{ word: "market", count: 9, score: 10 },
		{ word: "material", count: 6, score: 7 },
	],
	"matches case-insensitively, filters by prefix, and keeps the strongest duplicate relation",
);
assert.deepEqual(findCollocationCandidates(data, "make", "zz"), []);
assert.deepEqual(findCollocationCandidates(data, "missing", "ma"), []);
assert.ok(findCollocationCandidates(data, "make", "ma").some(({ word }) => word === "material"),
	"forward adjective-to-noun relation contributes a candidate");
assert.ok(!findCollocationCandidates(data, "make", "mi").some(({ word }) => word === "mistaken"),
	"backward relations are not treated as forward suggestions");
console.log("Collocation tests passed.");
