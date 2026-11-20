import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const [mode, file, label = "model"] = process.argv.slice(2);
if (mode === "--child") {
  process.stdout.write(JSON.stringify(loadAndMeasure(file, label)));
} else {
  const base = path.resolve(mode || "data/experiments/compact");
  const json = runChild(path.join(base, "json/model.json"), "json");
  const binary = runChild(path.join(base, "binary/model.ptng"), "binary");
  const report = { configuration: path.basename(base), json, binary,
    equivalent_index_hash: json.index_hash && binary.index_hash ? json.index_hash === binary.index_hash : null,
    equivalent_lookup_hash: json.lookup_hash && binary.lookup_hash ? json.lookup_hash === binary.lookup_hash : null,
    lookup_speedup_binary_over_json: json.lookup_ms_per_100k && binary.lookup_ms_per_100k
      ? json.lookup_ms_per_100k / binary.lookup_ms_per_100k : null };
  fs.writeFileSync(path.join(base, "format-benchmark.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

function runChild(filename, label) {
  const result = spawnSync(process.execPath, ["--expose-gc", self, "--child", filename, label],
    { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.status !== 0) {
    const stderr = result.stderr || "";
    const fatalAt = stderr.lastIndexOf("FATAL ERROR:");
    const error = result.error?.message || (fatalAt >= 0 ? stderr.slice(fatalAt, fatalAt + 180).trim() : stderr.slice(0, 400)) || `child exited ${result.status}`;
    return { error, status: result.status, signal: result.signal };
  }
  return JSON.parse(result.stdout);
}

function loadAndMeasure(filename, kind) {
  global.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  let bytes = fs.readFileSync(filename);
  const fileBytes = bytes.byteLength;
  const manifestPath = path.resolve(path.dirname(path.dirname(filename)), "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedHash = manifest[`${kind}_sha256`];
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (!expectedHash || actualHash !== expectedHash) throw new Error(`Integrity check failed for ${kind} model`);
  let model = kind === "json" ? parseJson(bytes) : parseBinary(bytes);
  if (kind === "json") bytes = null;
  global.gc?.();
  const after = process.memoryUsage();
  const loadMs = performance.now() - start;
  const lookupStart = performance.now();
  let seen = 0;
  const queryHash = createHash("sha256");
  const contexts = model.sampleContexts;
  for (let i = 0; i < 100_000; i++) {
    const key = contexts[(i * 7919) % contexts.length];
    const hits = model.lookup(key, i % 2 ? "a" : "t", 5);
    for (const [wordId, count] of hits) queryHash.update(`${model.vocabulary[wordId]}:${count};`);
    seen += hits.length;
  }
  const lookupMs = performance.now() - lookupStart;
  return { file_bytes: fileBytes, vocabulary_size: model.vocabulary.length,
    context_count: model.contextCount, record_count: model.records,
    load_ms: +loadMs.toFixed(2), lookup_ms_per_100k: +lookupMs.toFixed(2),
    lookup_results_examined: seen, heap_before_bytes: before.heapUsed,
    heap_after_bytes: after.heapUsed, heap_delta_bytes: after.heapUsed - before.heapUsed,
    rss_after_bytes: after.rss, peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    index_hash: model.indexHash, lookup_hash: queryHash.digest("hex") };
}

function parseJson(bytes) {
  let data = JSON.parse(bytes.toString("utf8"));
  if (data.version !== 1 || !Array.isArray(data.vocabulary) || !Array.isArray(data.records)) throw new Error("Invalid JSON model header");
  const vocabulary = data.vocabulary;
  const index = new Map();
  const digest = createHash("sha256");
  let records = 0;
  for (const record of data.records) {
    const [n, ...values] = record;
    if (!Number.isInteger(n) || n < 1 || n > 4 || values.length !== n + 1) throw new Error("Invalid n-gram record");
    const count = values.pop(), target = values.pop(), context = values;
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isInteger(target) || target < 0 || target >= vocabulary.length || context.some((id) => !Number.isInteger(id) || id < 0 || id >= vocabulary.length)) throw new Error("Invalid n-gram value");
    const key = `${n}:${context.join(",")}`;
    let entries = index.get(key);
    if (!entries) { index.set(key, entries = []); digest.update(key + ":"); }
    entries.push([target, count]);
    digest.update(`${vocabulary[target]}=${count},`);
    records++;
  }
  const sampleContexts = [];
  for (const key of index.keys()) {
    if (Number(key.slice(0, key.indexOf(":"))) > 1 && sampleContexts.length < 1000) sampleContexts.push(key);
  }
  if (!sampleContexts.length) throw new Error("Model has no multiword contexts to benchmark");
  const indexHash = digest.digest("hex");
  data = null;
  return { vocabulary, index, records, contextCount: index.size, sampleContexts, indexHash,
    lookup: (key, prefix, limit) => (index.get(key) || []).filter(([id]) => vocabulary[id].startsWith(prefix)).slice(0, limit) };
}

function parseBinary(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.toString("ascii", 0, 4) !== "PTNG" || view.getUint32(4, true) !== 1) throw new Error("Invalid binary magic/version");
  const vocabCount = view.getUint32(8, true), orderCounts = [0, 1, 2, 3].map((i) => Number(view.getBigUint64(12 + i * 8, true)));
  let offset = 44;
  const vocabulary = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < vocabCount; i++) {
    if (offset + 2 > bytes.length) throw new Error("Truncated vocabulary length");
    const length = view.getUint16(offset, true); offset += 2;
    if (offset + length > bytes.length) throw new Error("Truncated vocabulary value");
    vocabulary.push(decoder.decode(bytes.subarray(offset, offset + length))); offset += length;
  }
  const sectionStarts = [0, 0, 0, 0];
  for (let n = 1; n <= 4; n++) {
    sectionStarts[n - 1] = offset;
    offset += orderCounts[n - 1] * (1 + (n + 1) * 4);
    if (offset > bytes.length) throw new Error("Truncated n-gram section");
  }
  if (offset !== bytes.length) throw new Error("Unexpected trailing binary bytes");
  const indexHash = createHash("sha256");
  const sampleContexts = [];
  let contextCount = 0, records = 0;
  for (let n = 1; n <= 4; n++) {
    const section = sectionStarts[n - 1], recordSize = 1 + (n + 1) * 4;
    let previous = null;
    for (let i = 0; i < orderCounts[n - 1]; i++) {
      const at = section + i * recordSize;
      if (view.getUint8(at) !== n) throw new Error("Invalid n-gram order");
      const context = [];
      for (let j = 0; j < n - 1; j++) {
        const id = view.getUint32(at + 1 + j * 4, true);
        if (id >= vocabCount) throw new Error("Context word ID out of range");
        context.push(id);
      }
      const target = view.getUint32(at + 1 + (n - 1) * 4, true);
      const count = view.getUint32(at + 1 + n * 4, true);
      if (target >= vocabCount || !count) throw new Error("Invalid target/count");
      const key = `${n}:${context.join(",")}`;
      if (key !== previous) {
        previous = key; contextCount++;
        indexHash.update(key + ":");
        if (n > 1 && sampleContexts.length < 1000) sampleContexts.push(key);
      }
      indexHash.update(`${vocabulary[target]}=${count},`);
      records++;
    }
  }
  if (!sampleContexts.length) throw new Error("Model has no multiword contexts to benchmark");
  const index = { vocabulary, view, sectionStarts, orderCounts };
  return { vocabulary, records, contextCount, sampleContexts, indexHash: indexHash.digest("hex"), index,
    lookup: (key, prefix, limit) => binaryLookup(index, key, prefix, limit) };
}

function binaryLookup(model, key, prefix, limit) {
  const separator = key.indexOf(":");
  const n = Number(key.slice(0, separator));
  const context = key.slice(separator + 1).split(",").filter(Boolean).map(Number);
  const count = model.orderCounts[n - 1];
  const section = model.sectionStarts[n - 1];
  const recordSize = 1 + (n + 1) * 4;
  let low = 0, high = count;
  const compare = (recordIndex) => {
    const at = section + recordIndex * recordSize + 1;
    for (let j = 0; j < context.length; j++) {
      const value = model.view.getUint32(at + j * 4, true);
      if (value < context[j]) return -1;
      if (value > context[j]) return 1;
    }
    return 0;
  };
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(middle) < 0) low = middle + 1;
    else high = middle;
  }
  const hits = [];
  for (let i = low; i < count && compare(i) === 0; i++) {
    const at = section + i * recordSize;
    const wordId = model.view.getUint32(at + 1 + (n - 1) * 4, true);
    const frequency = model.view.getUint32(at + 1 + n * 4, true);
    if (model.vocabulary[wordId].startsWith(prefix)) {
      hits.push([wordId, frequency]);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
