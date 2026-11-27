#!/usr/bin/env python3
"""Extract OANC GrAF and create deterministic, sentence-aware token JSONL."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "local-corpora/oanc/raw/OANC_GrAF.zip"
EXTRACTED = ROOT / "local-corpora/oanc/extracted"
METADATA = ROOT / "local-corpora/oanc/metadata"
PREPARED = ROOT / "local-corpora/oanc/prepared"
TEXT_RE = re.compile(r"[a-z]+(?:['’\-][a-z]+)*", re.IGNORECASE)
TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
FALLBACK_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n{2,}")


def doc_split(relative_path: str) -> str:
    """Stable document-level 80/10/10 split, independent of filesystem order."""
    bucket = int(hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "train" if bucket < 80 else "validation" if bucket < 90 else "test"


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sentence_spans(annotation: Path, text_length: int) -> list[tuple[int, int]]:
    """Read stand-off GrAF regions attached to sentence/utterance annotations."""
    root = ET.parse(annotation).getroot()
    regions: dict[str, tuple[int, int]] = {}
    node_regions: dict[str, list[str]] = {}
    annotations: list[tuple[str, str]] = []
    for el in root.iter():
        tag = _local_name(el.tag)
        ident = el.attrib.get("{http://www.w3.org/XML/1998/namespace}id") or el.attrib.get("id")
        if tag == "region" and ident:
            anchors = el.attrib.get("anchors", "").split()
            if len(anchors) == 2:
                try:
                    start, end = int(anchors[0]), int(anchors[1])
                    if 0 <= start < end <= text_length:
                        regions[ident] = (start, end)
                except ValueError:
                    pass
        elif tag == "node" and ident:
            node_regions[ident] = [target for link in el if _local_name(link.tag) == "link"
                                   for target in link.attrib.get("targets", "").split()]
        elif tag == "a":
            annotations.append((el.attrib.get("label", ""), el.attrib.get("ref", "")))
    wanted = {"s", "sentence", "u", "utterance"}
    spans = set()
    for label, node in annotations:
        if label.lower() not in wanted:
            continue
        for region in node_regions.get(node, []):
            if region in regions:
                spans.add(regions[region])
    return sorted(spans)


def tokenize_sentence(sentence: str) -> list[str]:
    # Match src/language/modules/english.ts: ASCII letters, internal apostrophes
    # (straight/curly) and ASCII hyphens; then lowercase with English rules.
    cleaned = TAG_RE.sub(" ", html.unescape(sentence))
    cleaned = "".join(ch if ch in "\t\n\r" or ord(ch) >= 32 else " " for ch in cleaned)
    return [m.group(0).lower() for m in TEXT_RE.finditer(cleaned)]


def split_text(text: str, annotation: Path | None) -> tuple[list[list[str]], bool]:
    spans = sentence_spans(annotation, len(text)) if annotation and annotation.is_file() else []
    used_fallback = not spans
    if used_fallback:
        # Punctuation remains present while boundaries are selected.
        spans = []
        start = 0
        for match in re.finditer(r"[.!?]+(?:[\"'’”)]*)?(?:\s+|$)|\n{2,}", text):
            end = match.end()
            spans.append((start, end))
            start = end
        if start < len(text):
            spans.append((start, len(text)))
        if not spans and text.strip():
            spans = [(0, len(text))]
    result = [tokens for start, end in spans if (tokens := tokenize_sentence(text[start:end]))]
    return result, used_fallback


def extract_archive(archive: Path, target: Path) -> None:
    if not archive.is_file():
        raise FileNotFoundError(f"Official OANC archive not found: {archive}")
    test = subprocess.run(["unzip", "-tq", str(archive)], capture_output=True, text=True)
    if test.returncode:
        raise RuntimeError(f"Archive integrity check failed: {test.stderr or test.stdout}")
    target.mkdir(parents=True, exist_ok=True)
    marker = target / ".oanc-extracted"
    if marker.exists():
        return
    subprocess.run(["unzip", "-q", str(archive), "-d", str(target)], check=True)
    marker.write_text("OANC_GrAF.zip extracted\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    parser.add_argument("--extracted", type=Path, default=EXTRACTED)
    parser.add_argument("--prepared", type=Path, default=PREPARED)
    parser.add_argument("--no-extract", action="store_true", help="Use an already extracted corpus")
    args = parser.parse_args()
    started = time.perf_counter()
    METADATA.mkdir(parents=True, exist_ok=True)
    if not args.no_extract:
        extract_archive(args.archive, args.extracted)
    data_root = args.extracted / "OANC-GrAF/data"
    if not data_root.is_dir():
        raise FileNotFoundError(f"Expected OANC GrAF data directory: {data_root}")
    args.prepared.mkdir(parents=True, exist_ok=True)
    out_paths = {name: args.prepared / f"{name}.jsonl" for name in ("train", "validation", "test")}
    handles = {name: path.open("w", encoding="utf-8", newline="\n") for name, path in out_paths.items()}
    totals = {"documents_seen": 0, "documents_accepted": 0, "documents_rejected": 0,
              "sentences": 0, "tokens": 0, "unique_words": set(), "annotation_fallback_documents": 0,
              "split": {name: {"documents": 0, "sentences": 0, "tokens": 0} for name in handles}}
    try:
        for text_path in sorted(data_root.rglob("*.txt")):
            totals["documents_seen"] += 1
            relative = text_path.relative_to(data_root).as_posix()
            annotation = text_path.with_name(text_path.stem + "-s.xml")
            try:
                text = text_path.read_text(encoding="utf-8-sig")
                sentences, fallback = split_text(text, annotation)
                tokens_in_doc = sum(map(len, sentences))
                if not sentences or tokens_in_doc == 0:
                    totals["documents_rejected"] += 1
                    continue
                split = doc_split(relative)
                totals["documents_accepted"] += 1
                totals["annotation_fallback_documents"] += int(fallback)
                totals["split"][split]["documents"] += 1
                for tokens in sentences:
                    handles[split].write(json.dumps({"document": relative, "tokens": tokens}, ensure_ascii=False,
                                                    separators=(",", ":")) + "\n")
                    totals["sentences"] += 1
                    totals["tokens"] += len(tokens)
                    totals["split"][split]["sentences"] += 1
                    totals["split"][split]["tokens"] += len(tokens)
                    totals["unique_words"].update(tokens)
            except (OSError, UnicodeError, ET.ParseError, ValueError):
                totals["documents_rejected"] += 1
    finally:
        for handle in handles.values():
            handle.close()
    archive_digest = hashlib.sha256()
    with args.archive.open("rb") as archive_file:
        for block in iter(lambda: archive_file.read(1024 * 1024), b""):
            archive_digest.update(block)
    report = {**totals, "unique_words": len(totals["unique_words"]),
              "tokenizer": "src/language/modules/english.ts regex [a-z]+(?:['’-][a-z]+)* / i; lowercase en-US",
              "split_method": "sha256(relative document path) mod 100: 80/10/10",
              "sentence_boundaries": "OANC GrAF -s.xml regions; punctuation fallback only if annotations unavailable",
              "archive": str(args.archive), "archive_sha256": archive_digest.hexdigest(),
              "elapsed_seconds": round(time.perf_counter() - started, 3)}
    (METADATA / "prepare-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    source_metadata_path = METADATA / "oanc-source.json"
    try:
        source_metadata = json.loads(source_metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        source_metadata = {}
    source_metadata.update({
        "name": "Open American National Corpus (OANC) GrAF",
        "release": "2026-09-25 (official ANC download link)",
        "url": "https://anc.org/data/oanc/",
        "archive_url": "https://github.com/nancyide/anc-website/releases/download/datasets-2026-09-25/OANC_GrAF.zip",
        "license": "Official OANC page states unrestricted use and redistribution, including commercial use; derived resources are invited.",
        "attribution": "Contains data derived from the Open American National Corpus (OANC), https://anc.org/data/oanc/",
        "sha256": report["archive_sha256"]
    })
    source_metadata_path.write_text(json.dumps(source_metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in {"unique_words"}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
