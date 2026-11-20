import assert from "node:assert/strict";
import { NGramModel } from "../prediction/ngram";
import { englishCorpus } from "../prediction/corpus/english";
import { english } from "../language/modules/english";

const model = new NGramModel(
        englishCorpus,
        english.rules.tokenize,
        english.rules.normalizeWord,
);

const tests = [
        {
                context: ["of"],
                prefix: "co",
                expected: "course",
        },
        {
                context: ["I", "would"],
                prefix: "li",
                expected: "like",
        },
        {
                context: ["thank", "you"],
                prefix: "fo",
                expected: "for",
        },
];

let failed = 0;

for (const test of tests) {
        const result = model.predict(test.context, test.prefix);

        const passed = result.includes(test.expected);

        console.log(
                `${passed ? "OK" : "FAIL"}: ${test.context.join(" ")} ${test.prefix} →`,
                result,
        );

        if (!passed) failed++;
}

if (failed > 0) {
        throw new Error(`Не пройдено тестов: ${failed}`);
}

console.log("Все тесты пройдены!");

const backoffModel = new NGramModel(
	["alpha beta charlie delta", "alpha beta charlie dog", "other beta charlie dove"],
	(text) => text.split(/\s+/u),
	(word) => word.toLowerCase(),
);

assert.deepEqual(backoffModel.predict(["alpha", "beta", "charlie"], "d"), ["delta", "dog"]);
assert.deepEqual(backoffModel.predict(["missing", "beta", "charlie"], "do"), ["dog", "dove"]);
assert.deepEqual(backoffModel.predict(["missing", "charlie"], "de"), ["delta"]);
assert.deepEqual(backoffModel.predict(["missing"], "al"), ["alpha"]);
assert.deepEqual(backoffModel.predict(["alpha"], "a", 0), []);
console.log("Backoff tests passed (4-gram through unigram, plus zero-result limit).");
