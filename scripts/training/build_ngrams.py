#!/usr/bin/env python3
"""Build bounded-memory OANC n-gram counts and JSON/binary experiments."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import struct
import sys
import time
import resource
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREPARED = ROOT / "local-corpora/oanc/prepared"
DB_PATH = ROOT / "local-corpora/oanc/metadata/ngrams.sqlite3"
OUT_ROOT = ROOT / "data/experiments"
FORMAT_VERSION = 1
STATS_MAGIC = b"PTGS"
STATS_VERSION = 1
MAGIC = b"PTNG"
CONFIGS = {"full": (1, 0), "moderate": (2, 50), "compact": (3, 20)}


def flush_counts(db: sqlite3.Connection, counts: Counter[tuple[int, str, str]]) -> None:
    if not counts:
        return
    db.executemany("""INSERT INTO ngrams(order_n, context, next_word, count) VALUES(?,?,?,?)
        ON CONFLICT(order_n, context, next_word) DO UPDATE SET count=count+excluded.count""",
        ((n, context, word, count) for (n, context, word), count in counts.items()))
    counts.clear()


def train(train_path: Path, db_path: Path, batch_size: int = 50_000) -> dict:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("PRAGMA temp_store=FILE")
    db.execute("CREATE TABLE ngrams(order_n INTEGER, context TEXT, next_word TEXT, count INTEGER NOT NULL, PRIMARY KEY(order_n, context, next_word)) WITHOUT ROWID")
    counters: Counter[tuple[int, str, str]] = Counter()
    n_tokens = n_sentences = 0
    started = time.perf_counter()
    with train_path.open(encoding="utf-8") as source:
        for line in source:
            record = json.loads(line)
            words = record["tokens"]
            n_sentences += 1
            n_tokens += len(words)
            if n_sentences % 100_000 == 0:
                print(f"processed {n_sentences:,} sentences / {n_tokens:,} tokens", flush=True)
            for i, word in enumerate(words):
                for order in range(1, min(4, i + 1) + 1):
                    context = " ".join(words[i-order+1:i]) if order > 1 else ""
                    counters[(order, context, word)] += 1
            if len(counters) >= batch_size:
                flush_counts(db, counters)
                db.commit()
    flush_counts(db, counters)
    db.commit()
    order_counts = {str(n): db.execute("SELECT COUNT(*) FROM ngrams WHERE order_n=?", (n,)).fetchone()[0]
                    for n in range(1, 5)}
    db.execute("CREATE INDEX ngrams_context_idx ON ngrams(order_n, context, count DESC)")
    db.commit()
    db.close()
    maxrss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    maxrss_bytes = int(maxrss if sys.platform == "darwin" else maxrss * 1024)
    return {"training_sentences": n_sentences, "training_tokens": n_tokens,
            "unique_ngrams": order_counts, "training_seconds": round(time.perf_counter()-started, 3),
            "database_bytes": db_path.stat().st_size, "training_peak_rss_bytes": maxrss_bytes}


def read_rows(db_path: Path, minimum: int, max_successors: int):
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        query = "SELECT order_n, context, next_word, count FROM ngrams WHERE count >= ? ORDER BY order_n, context, count DESC, next_word"
        previous_context = None
        emitted_for_context = 0
        for row in db.execute(query, (minimum,)):
            n, context, word, count = row
            key = (n, context)
            if key != previous_context:
                previous_context, emitted_for_context = key, 0
            if n > 1 and max_successors and emitted_for_context >= max_successors:
                continue
            emitted_for_context += 1
            yield n, context, word, count
    finally:
        db.close()


def export_config(db_path: Path, name: str, minimum: int, max_successors: int, out_root: Path) -> dict:
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    vocab = [row[0] for row in db.execute("SELECT next_word FROM ngrams WHERE order_n=1 ORDER BY next_word")]
    db.close()
    ids = {word: i for i, word in enumerate(vocab)}
    counts = {str(n): sum(1 for row in read_rows(db_path, minimum, max_successors) if row[0] == n)
              for n in range(1, 5)}
    target = out_root / name
    json_dir, bin_dir = target / "json", target / "binary"
    json_dir.mkdir(parents=True, exist_ok=True)
    bin_dir.mkdir(parents=True, exist_ok=True)
    json_path, binary_path = json_dir / "model.json", bin_dir / "model.ptng"
    t0 = time.perf_counter()
    with json_path.open("w", encoding="utf-8", newline="\n") as f:
        f.write('{"version":1,"vocabulary":')
        json.dump(vocab, f, ensure_ascii=False, separators=(",", ":"))
        f.write(',"records":[')
        first = True
        for n, context, word, count in read_rows(db_path, minimum, max_successors):
            record = [n, *(ids[t] for t in context.split()), ids[word], count]
            if not first: f.write(",")
            json.dump(record, f, separators=(",", ":"))
            first = False
        f.write("]}")
    json_seconds = time.perf_counter() - t0
    t0 = time.perf_counter()
    with binary_path.open("wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<II4Q", FORMAT_VERSION, len(vocab), *(counts[str(n)] for n in range(1, 5))))
        for word in vocab:
            encoded = word.encode("utf-8")
            if len(encoded) > 65535: raise ValueError("Word too long for v1 vocabulary record")
            f.write(struct.pack("<H", len(encoded)))
            f.write(encoded)
        for n, context, word, count in read_rows(db_path, minimum, max_successors):
            context_ids = [ids[t] for t in context.split()]
            f.write(struct.pack("<B", n))
            f.write(struct.pack("<" + "I" * n + "I", *context_ids, ids[word], count))
    binary_seconds = time.perf_counter() - t0
    stats_path = bin_dir / "context-stats.ptgs"
    stats_counts, stats_seconds = export_context_statistics(db_path, stats_path, ids, minimum)
    manifest = {"format_version": FORMAT_VERSION, "corpus": "OANC GrAF 2026-09-25",
                "configuration": name, "min_count": minimum, "max_successors_per_context": max_successors or None,
                "vocabulary_count": len(vocab), "record_counts": counts,
                "json_bytes": json_path.stat().st_size, "binary_bytes": binary_path.stat().st_size,
                "json_export_seconds": round(json_seconds, 3), "binary_export_seconds": round(binary_seconds, 3),
                "json_sha256": sha256_file(json_path), "binary_sha256": sha256_file(binary_path)}
    manifest.update({"context_statistics_file": "binary/context-stats.ptgs",
                     "context_statistics_version": STATS_VERSION,
                     "context_statistics_context_counts": stats_counts,
                     "context_statistics_bytes": stats_path.stat().st_size,
                     "context_statistics_seconds": round(stats_seconds, 3),
                     "context_statistics_sha256": sha256_file(stats_path)})
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def export_context_statistics(db_path: Path, output: Path, ids: dict[str, int], minimum: int):
    """Export complete train context totals/types for contexts with retained rows.

    PTGS stores full unigram counts followed by context tuples for lengths 1..3.
    Unlike PTNG pruning, these totals and continuation type counts are computed
    before pruning and let runtime interpolation assign omitted mass to backoff.
    """
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    counts = [db.execute("""SELECT COUNT(*) FROM (
                    SELECT context FROM ngrams WHERE order_n=? GROUP BY context HAVING MAX(count)>=?)""",
                         (order, minimum)).fetchone()[0] for order in (2, 3, 4)]
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with output.open("wb") as stream:
        stream.write(STATS_MAGIC)
        stream.write(struct.pack("<II3I", STATS_VERSION, len(ids), *counts))
        # The vocab is ID-sorted; the full unigram vector is small (under 1 MiB).
        full_unigrams = dict(db.execute("SELECT next_word,count FROM ngrams WHERE order_n=1"))
        for word, _ in sorted(ids.items(), key=lambda item: item[1]):
            count = full_unigrams.get(word, 0)
            if count > 0xFFFFFFFF: raise ValueError("Unigram count exceeds PTGS v1 uint32 limit")
            stream.write(struct.pack("<I", count))
        for order in (2, 3, 4):
            context_length = order - 1
            rows = db.execute("""SELECT context,SUM(count),COUNT(*) FROM ngrams
                WHERE order_n=? GROUP BY context HAVING MAX(count)>=? ORDER BY context""",
                              (order, minimum))
            written = 0
            for context, context_total, continuation_types in rows:
                context_ids = [ids[word] for word in context.split()]
                if len(context_ids) != context_length:
                    raise ValueError(f"Unexpected context word count for {context!r}")
                if context_total > 0xFFFFFFFF or continuation_types > 0xFFFFFFFF:
                    raise ValueError("Context statistics exceed PTGS v1 uint32 limits")
                stream.write(struct.pack("<" + "I" * context_length + "II",
                                         *context_ids, context_total, continuation_types))
                written += 1
            if written != counts[context_length - 1]:
                raise ValueError("PTGS context count changed while exporting")
    db.close()
    return {str(length): count for length, count in enumerate(counts, start=1)}, time.perf_counter() - started


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared", type=Path, default=PREPARED)
    parser.add_argument("--database", type=Path, default=DB_PATH)
    parser.add_argument("--output", type=Path, default=OUT_ROOT)
    parser.add_argument("--batch-size", type=int, default=50_000)
    parser.add_argument("--skip-train", action="store_true")
    parser.add_argument("--only-config", choices=tuple(CONFIGS))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / "build-report.json"
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        report = {}
    if not args.skip_train:
        report.update(train(args.prepared / "train.jsonl", args.database, args.batch_size))
    elif "training_tokens" not in report:
        db = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
        order_counts = {str(n): db.execute("SELECT COUNT(*) FROM ngrams WHERE order_n=?", (n,)).fetchone()[0]
                        for n in range(1, 5)}
        training_tokens = db.execute("SELECT SUM(count) FROM ngrams WHERE order_n=1").fetchone()[0] or 0
        db.close()
        try:
            prep = json.loads((ROOT / "local-corpora/oanc/metadata/prepare-report.json").read_text(encoding="utf-8"))
            training_sentences = prep["split"]["train"]["sentences"]
        except (OSError, json.JSONDecodeError, KeyError):
            training_sentences = None
        report.update({"training_sentences": training_sentences, "training_tokens": training_tokens,
                       "unique_ngrams": order_counts, "database_bytes": args.database.stat().st_size})
    configs = {args.only_config: CONFIGS[args.only_config]} if args.only_config else CONFIGS
    for name, (minimum, cap) in configs.items():
        export_config(args.database, name, minimum, cap, args.output)
    manifests = []
    for name in CONFIGS:
        manifest_path = args.output / name / "manifest.json"
        if manifest_path.is_file():
            manifests.append(json.loads(manifest_path.read_text(encoding="utf-8")))
    report["configurations"] = manifests
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
