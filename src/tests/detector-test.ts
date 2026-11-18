import { detectLanguage } from "../language/detector";

const tests = [
	{ text: "Привет, как твои дела?", expected: "ru" },
	{ text: "Hello, how are you?", expected: "en" },
	{ text: "Guten Tag, wie geht es dir?", expected: "de" },
	{ text: "Bună ziua, ce mai faci?", expected: "ro" },
	{ text: "12345", expected: null },
] as const;

let passed = 0;

for (const test of tests) {
	const result = detectLanguage(test.text);
	const ok = result === test.expected;

	if (ok) passed++;

	console.log(
		ok ? "OK" : "ОШИБКА",
		`Текст: "${test.text}"`,
		`Ожидалось: ${test.expected}`,
		`Получено: ${result}`,
	);
}

console.log(`\nРезультат: ${passed}/${tests.length} тестов пройдено`);
