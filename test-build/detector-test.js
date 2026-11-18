"use strict";

// src/language/detector.ts
var LANGUAGE_MARKERS = {
  en: /\b(the|and|this|that|with|have|you|are|for)\b/gi,
  de: /\b(der|die|das|und|ist|nicht|mit|ein|eine|guten|tag|wie|geht|dir|ich|du|hallo|danke)\b/gi,
  ro: /\b(și|sunt|este|pentru|care|acest|această|din|în)\b/gi
};
function detectLanguage(text) {
  const normalized = text.toLocaleLowerCase();
  if (/[а-яё]/i.test(normalized)) return "ru";
  const scores = { en: 0, de: 0, ro: 0 };
  if (/[äöüß]/i.test(normalized)) scores.de += 3;
  if (/[ăâîșț]/i.test(normalized)) scores.ro += 3;
  for (const language of Object.keys(LANGUAGE_MARKERS)) {
    const matches = normalized.match(LANGUAGE_MARKERS[language]);
    scores[language] += matches ? matches.length * 2 : 0;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return null;
  return best[0];
}

// src/tests/detector-test.ts
var tests = [
  { text: "\u041F\u0440\u0438\u0432\u0435\u0442, \u043A\u0430\u043A \u0442\u0432\u043E\u0438 \u0434\u0435\u043B\u0430?", expected: "ru" },
  { text: "Hello, how are you?", expected: "en" },
  { text: "Guten Tag, wie geht es dir?", expected: "de" },
  { text: "Bun\u0103 ziua, ce mai faci?", expected: "ro" },
  { text: "12345", expected: null }
];
var passed = 0;
for (const test of tests) {
  const result = detectLanguage(test.text);
  const ok = result === test.expected;
  if (ok) passed++;
  console.log(
    ok ? "OK" : "\u041E\u0428\u0418\u0411\u041A\u0410",
    `\u0422\u0435\u043A\u0441\u0442: "${test.text}"`,
    `\u041E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C: ${test.expected}`,
    `\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E: ${result}`
  );
}
console.log(`
\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442: ${passed}/${tests.length} \u0442\u0435\u0441\u0442\u043E\u0432 \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u043E`);
