#!/usr/bin/env python3
"""Create a reproducible held-out evaluation split from excluded OANC genres.

Input is the existing train partition only. BioMed Central/PLOS documents are
repartitioned 80/10/10 by document; every other source document stays in train.
The checked-in OANC word/collocation resources exclude these two genres.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "local-corpora/oanc/prepared/train.jsonl"
DEFAULT_OUTPUT = ROOT / "local-corpora/oanc/prepared/stage5-independent"
SPLIT_SALT = "polytype-stage5-independent-biomed-plos-v1"
EXCLUDED_RESOURCE_PREFIXES = (
    "written_2/technical/biomed/",
    "written_2/technical/plos/",
)


def assigned_split(document: str) -> str:
    bucket = int(hashlib.sha256(f"{SPLIT_SALT}\0{document}".encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 80 else "validation" if bucket < 90 else "test"


def create_split(source: Path, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    handles = {name: (output / f"{name}.jsonl").open("w", encoding="utf-8", newline="\n")
               for name in ("train", "validation", "test")}
    documents: dict[str, set[str]] = defaultdict(set)
    totals = {name: {"sentences": 0, "tokens": 0} for name in handles}
    try:
        with source.open(encoding="utf-8") as input_file:
            for line_number, line in enumerate(input_file, 1):
                record = json.loads(line)
                document, tokens = record.get("document"), record.get("tokens")
                if not isinstance(document, str) or not isinstance(tokens, list) \
                        or not all(isinstance(token, str) for token in tokens):
                    raise ValueError(f"Invalid prepared OANC record at line {line_number}")
                if any(document.startswith(prefix) for prefix in EXCLUDED_RESOURCE_PREFIXES):
                    split = assigned_split(document)
                else:
                    split = "train"
                handles[split].write(line)
                documents[split].add(document)
                totals[split]["sentences"] += 1
                totals[split]["tokens"] += len(tokens)
    finally:
        for handle in handles.values():
            handle.close()

    if documents["train"] & documents["validation"] or documents["train"] & documents["test"] \
            or documents["validation"] & documents["test"]:
        raise RuntimeError("Document leakage detected between independent splits")
    for split in ("validation", "test"):
        if not documents[split] or any(not document.startswith(EXCLUDED_RESOURCE_PREFIXES)
                                       for document in documents[split]):
            raise RuntimeError(f"{split} must contain only documents excluded from shipped OANC resources")

    manifest = {
        "split_version": 1,
        "salt": SPLIT_SALT,
        "source_partition": str(source),
        "source_partition_was_train_only": True,
        "holdout_genres": ["written_2/technical/biomed", "written_2/technical/plos"],
        "holdout_policy": "document SHA-256 80/10/10; all other source documents retained in train",
        "external_resource_exclusion": "Shipped OANC written word frequencies and collocations exclude BioMed Central and PLOS",
        "splits": {
            name: {"documents": len(documents[name]), **totals[name],
                  "jsonl_sha256": sha256_file(output / f"{name}.jsonl")}
            for name in handles
        },
    }
    (output / "split-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json.dumps(create_split(args.source, args.output), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
