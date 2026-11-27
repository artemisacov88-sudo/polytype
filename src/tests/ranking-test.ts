import assert from "node:assert/strict";
import { rankCandidates } from "../prediction/ranking";

const ranked = rankCandidates(
	[
		{ word: "common", frequency: 298407 },
		{
			word: "contextual",
			frequency: 100,
			ngramCount: 8,
			ngramContextCount: 10,
			ngramContextLength: 3,
		},
		{
			word: "collocated",
			frequency: 100,
			collocationScore: 12,
			collocationCount: 20,
		},
	],
	298407,
);

assert.equal(ranked[0]?.word, "contextual", "strong context can outrank a globally frequent word");
assert.ok(
	ranked.findIndex(({ word }) => word === "collocated") > ranked.findIndex(({ word }) => word === "common"),
	"collocation evidence participates in candidate ranking",
);
console.log("Frequency ranking tests passed.");
