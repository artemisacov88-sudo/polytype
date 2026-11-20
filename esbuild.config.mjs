import esbuild from "esbuild";
import { watchFile } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const dataFiles = [
  ["src/prediction/data/english-words.json", "data/english-words.json"],
  ["src/prediction/data/english-collocations.json", "data/english-collocations.json"],
];

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "./data/english-collocations.json"],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: "inline",
  logLevel: "info",
};

async function copyDataFiles() {
  await mkdir("data", { recursive: true });
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
