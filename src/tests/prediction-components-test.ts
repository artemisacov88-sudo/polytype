import assert from "node:assert/strict";
import { generateCandidates } from "../prediction/candidate-generation";
import { absoluteDiscountProbability, interpolatedAbsoluteDiscount } from "../prediction/context-probability";
import { interpolatedPrunedAbsoluteDiscount, preparePrunedContextDistribution } from "../prediction/backoff-smoothing";
import { collocationFeature } from "../prediction/collocation-scoring";
import { rankExperimentalCandidates } from "../prediction/experimental-ranking";

const context = {
	counts: new Map([["a", 4], ["b", 2], ["c", 2]]),
	contextTotal: 8,
	continuationTypes: 3,
};
const lower = new Map([["a", 0.5], ["b", 0.3], ["c", 0.2]]);
const probabilities = [...lower].map(([word, p]) => absoluteDiscountProbability(word, context, p, 0.5));
assert.ok(probabilities.every((p) => Number.isFinite(p) && p >= 0 && p <= 1));
assert.ok(Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) < 1e-12,
	"absolute discount plus lower-order interpolation sums to one when supplied complete statistics");
assert.equal(interpolatedAbsoluteDiscount("unknown", 0, 8, [], 0.5), 0,
	"unseen context falls back to unigram probability, with zero for an unknown word");
assert.throws(() => absoluteDiscountProbability("a", { ...context, contextTotal: 7 }, 0.2, 0.5),
	"pruned/inconsistent totals must not be accepted as complete statistics");
assert.throws(() => absoluteDiscountProbability("a", { ...context, counts: new Map([["a", 4]]) }, 0.2, 0.5),
	"a pruned continuation table must not be accepted as complete context statistics");
const pruned = preparePrunedContextDistribution({
	counts: new Map([["a", 4], ["b", 2]]), contextTotal: 10, continuationTypes: 3,
}, 0.5);
const backoffProbabilities = new Map([["a", 0.4], ["b", 0.3], ["c", 0.2], ["d", 0.1]]);
const smoothed = [...backoffProbabilities].map(([word, p]) =>
	interpolatedPrunedAbsoluteDiscount(word, p, [pruned], 0.5));
assert.ok(Math.abs(smoothed.reduce((sum, p) => sum + p, 0) - 1) < 1e-12,
	"all dropped/pruned probability mass backs off and remains normalized");

const candidates = generateCandidates("th", [
	[{ word: "the", frequency: 10 }, { word: "other", frequency: 100 }],
	[{ word: "there", frequency: 2, ngramCount: 4, ngramContextCount: 8, ngramContextLength: 2 }],
], 10);
assert.deepEqual(candidates.map(({ word }) => word), ["the", "there"], "prefix filtering and empty-result behavior");
assert.deepEqual(generateCandidates("zz", [[{ word: "there", frequency: 2 }]]), []);

const baselineRanking = rankExperimentalCandidates([
	{ word: "common", frequency: 100 },
	{ word: "context", frequency: 2, ngramCount: 8, ngramContextCount: 10, ngramContextLength: 3 },
], 100);
assert.equal(baselineRanking[0]?.word, "context", "context probability and reliability can outrank unigram frequency");
assert.ok(Number.isFinite(baselineRanking[0]?.score));
const sanitized = rankExperimentalCandidates([{ word: "bad", frequency: Number.NaN, ngramCount: Number.POSITIVE_INFINITY }], 0);
assert.ok(Number.isFinite(sanitized[0]?.score), "ranking must not emit NaN or Infinity");
const collocation = { word: "collocate", frequency: 1, collocationScore: 14, collocationCount: 100 };
assert.ok(collocationFeature(collocation) > 0 && collocationFeature({ word: "none", frequency: 0 }) === 0);
const tied = rankExperimentalCandidates([{ word: "beta", frequency: 1 }, { word: "alpha", frequency: 1 }], 1);
assert.deepEqual(tied.map(({ word }) => word), ["alpha", "beta"], "equal scores have deterministic lexical order");
assert.deepEqual(rankExperimentalCandidates([], 0), [], "empty ranking is stable");
console.log("Prediction component tests passed.");
