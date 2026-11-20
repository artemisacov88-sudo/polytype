"use strict";

// src/prediction/ngram.ts
var NGramModel = class {
  constructor(sentences, tokenize, normalize, maxContext = 3) {
    this.tokenize = tokenize;
    this.normalize = normalize;
    this.maxContext = maxContext;
    this.counts = /* @__PURE__ */ new Map();
    this.train(sentences);
  }
  train(sentences) {
    for (const sentence of sentences) {
      const words = this.tokenize(sentence).map(this.normalize).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        for (let size = 0; size <= Math.min(this.maxContext, i); size++) {
          const context = words.slice(i - size, i).join(" ");
          const nextWord = words[i];
          let candidates = this.counts.get(context);
          if (!candidates) {
            candidates = /* @__PURE__ */ new Map();
            this.counts.set(context, candidates);
          }
          candidates.set(
            nextWord,
            (candidates.get(nextWord) ?? 0) + 1
          );
        }
      }
    }
  }
  predict(contextWords, currentPrefix, limit = 5) {
    const context = contextWords.map(this.normalize).filter(Boolean).slice(-this.maxContext);
    const prefix = this.normalize(currentPrefix);
    for (let size = context.length; size >= 0; size--) {
      const key = context.slice(-size).join(" ");
      const candidates = this.counts.get(key);
      if (!candidates) continue;
      const results = [...candidates.entries()].filter(([word]) => word.startsWith(prefix)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
      if (results.length > 0) return results;
    }
    return [];
  }
};

// src/prediction/corpus/english.ts
var englishCorpus = [
  "of course",
  "of course not",
  "of the world",
  "of my life",
  "in my opinion",
  "in fact",
  "in order to",
  "in the future",
  "in the morning",
  "at the same time",
  "at the moment",
  "as soon as possible",
  "as well as",
  "on the other hand",
  "for example",
  "for instance",
  "I would like to",
  "I want to know",
  "I need to understand",
  "I have to go",
  "I think that",
  "I don't know",
  "I agree with you",
  "thank you very much",
  "thank you for your help",
  "how are you",
  "how are you doing",
  "what do you think",
  "what do you mean",
  "there is a problem",
  "there are many reasons",
  "it depends on the situation",
  "looking forward to seeing you",
  "one of the most important things",
  "a lot of people",
  "a little bit more",
  "would you like to",
  "could you please help me",
  "I am going to",
  "I am looking for"
];

// src/language/modules/english.ts
var english = {
  id: "en",
  displayName: "\u0410\u043D\u0433\u043B\u0438\u0439\u0441\u043A\u0438\u0439",
  rules: {
    tokenize(text) {
      return text.match(/[a-z]+(?:['’-][a-z]+)*/giu) ?? [];
    },
    normalizeWord(word) {
      return word.toLocaleLowerCase("en-US");
    }
  }
};

// src/tests/ngram-test.ts
var model = new NGramModel(
  englishCorpus,
  english.rules.tokenize,
  english.rules.normalizeWord
);
var tests = [
  {
    context: ["of"],
    prefix: "co",
    expected: "course"
  },
  {
    context: ["I", "would"],
    prefix: "li",
    expected: "like"
  },
  {
    context: ["thank", "you"],
    prefix: "fo",
    expected: "for"
  }
];
var failed = 0;
for (const test of tests) {
  const result = model.predict(test.context, test.prefix);
  const passed = result.includes(test.expected);
  console.log(
    `${passed ? "OK" : "FAIL"}: ${test.context.join(" ")} ${test.prefix} \u2192`,
    result
  );
  if (!passed) failed++;
}
if (failed > 0) {
  throw new Error(`\u041D\u0435 \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u043E \u0442\u0435\u0441\u0442\u043E\u0432: ${failed}`);
}
console.log("\u0412\u0441\u0435 \u0442\u0435\u0441\u0442\u044B \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u044B!");
