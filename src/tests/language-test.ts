
import { getLanguageModule } from "../language/registry";

const tests = [
	{ language: "ru", text: "Привет мир ёлка", expected: 3 },
	{ language: "en", text: "Hello world computer", expected: 3 },
	{ language: "de", text: "Grüße schön Straße", expected: 3 },
	{ language: "ro", text: "Bună ziua țară", expected: 3 },
] as const;

for (const test of tests) {
	const module = getLanguageModule(test.language);
	const words = module.rules.tokenize(test.text);

	console.log(
		`${module.displayName}:`,
		words.length === test.expected ? "OK" : "ОШИБКА",
		words,
	);
}
