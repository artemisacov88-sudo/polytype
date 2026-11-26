import esbuild from "esbuild";
import { watchFile } from "node:fs";
import { dirname } from "node:path";
import { copyFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const dataFiles = [
  ["src/prediction/data/english-words.json", "data/english-words.json"],
  ["src/prediction/data/english-collocations.json", "data/english-collocations.json"],
  ...["ru", "de", "ro"].flatMap((language) => [
    [`src/prediction/data/multilingual/${language}/words.json`, `data/multilingual/${language}/words.json`],
    [`src/prediction/data/multilingual/${language}/manifest.json`, `data/multilingual/${language}/manifest.json`],
    [`src/prediction/data/multilingual/${language}/binary/model.ptng`, `data/multilingual/${language}/binary/model.ptng`],
    [`src/prediction/data/multilingual/${language}/binary/context-stats.ptgs`, `data/multilingual/${language}/binary/context-stats.ptgs`],
    [`src/prediction/data/multilingual/${language}/ATTRIBUTION.txt`, `data/multilingual/${language}/ATTRIBUTION.txt`],
  ]),
];

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "@codemirror/*", "./data/english-collocations.json"],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: "inline",
  logLevel: "info",
};

async function copyDataFiles() {
  await Promise.all(dataFiles.map(([, target]) => mkdir(dirname(target), { recursive: true })));
  await Promise.all(dataFiles.map(([source, target]) => copyFile(source, target)));
}

if (watch) {
  await copyDataFiles();
  const context = await esbuild.context(options);
  await context.watch();

  let copyTimer;
  for (const [source] of dataFiles) {
    watchFile(source, { interval: 500 }, () => {
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        void copyDataFiles().catch((error) => {
          console.error("[PolyType] Failed to refresh local data files:", error);
        });
      }, 100);
    });
  }
  console.log("Watching TypeScript and local JSON resources.");
} else {
  await esbuild.build(options);
  await copyDataFiles();
}
