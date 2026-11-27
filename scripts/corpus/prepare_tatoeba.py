#!/usr/bin/env python3
"""Prepare language-specific, group-split Tatoeba text for PolyType models.

Reads only the official detailed-sentence and base-relation exports. It streams
the archives, keeps the source files untouched, and never scans user notes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import tarfile
import time
import unicodedata
from pathlib import Path
from typing import BinaryIO, Iterator

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "local-corpora/tatoeba/snapshot-2026-11-21"
DETAILS_ARCHIVE = SNAPSHOT / "sentences_detailed.tar.bz2"
BASE_ARCHIVE = SNAPSHOT / "sentences_base.tar.bz2"
PREPARED = SNAPSHOT / "prepared"
METADATA = SNAPSHOT / "metadata"
ATTRIBUTION = SNAPSHOT / "attribution"

LANGUAGES = {
    "rus": ("ru", re.compile(r"[а-яё]+", re.IGNORECASE)),
    "deu": ("de", re.compile(r"[a-zäöüß]+(?:['’\-][a-zäöüß]+)*", re.IGNORECASE)),
    "ron": ("ro", re.compile(r"[a-zăâîșțşţ]+", re.IGNORECASE)),
}
MAX_SENTENCE_TOKENS = 40


def parse_detail_line(line: bytes) -> tuple[int, str, str, str]:
    """Parse ID, ISO 639-3 language, text and author from the detailed TSV."""
    decoded = line.decode("utf-8").rstrip("\r\n")
    first = decoded.split("\t", 2)
    if len(first) != 3:
        raise ValueError("Malformed detailed sentence row")
    metadata = first[2].rsplit("\t", 3)
    if len(metadata) != 4:
        raise ValueError("Malformed detailed sentence metadata")
    sentence_id = int(first[0])
    language = first[1]
    text, author = metadata[0], metadata[1]
    if sentence_id < 1 or not language or not author:
        raise ValueError("Detailed sentence row has an empty required field")
    return sentence_id, language, text, author


def parse_base_line(line: bytes) -> tuple[int, int | None]:
    """Parse a sentence's translation-family root from sentences_base.csv."""
    fields = line.decode("utf-8").rstrip("\r\n").split("\t", 1)
    if len(fields) != 2:
        raise ValueError("Malformed sentence-base row")
    sentence_id = int(fields[0])
    base = None if fields[1] == r"\N" else int(fields[1])
    if sentence_id < 1 or (base is not None and base < 0):
        raise ValueError("Invalid sentence-base ID")
    return sentence_id, base


def translation_group_id(sentence_id: int, base_id: int | None) -> int:
    """Keep translations and their source sentence in the same data split."""
    if base_id is None or base_id == 0:
        return sentence_id
    return base_id


def split_for_group(group_id: int) -> str:
    bucket = int(hashlib.sha256(f"tatoeba-base:{group_id}".encode("ascii")).hexdigest()[:8], 16) % 100
    return "train" if bucket < 80 else "validation" if bucket < 90 else "test"


def tokenize(language_code: str, text: str) -> list[str]:
    language, pattern = LANGUAGES[language_code]
    normalized_text = unicodedata.normalize("NFC", text)
    words = [unicodedata.normalize("NFC", match.group(0)).lower() for match in pattern.finditer(normalized_text)]
    if language == "ru":
        words = [word.replace("ё", "е") for word in words]
    elif language == "ro":
        words = [word.replace("ş", "ș").replace("ţ", "ț") for word in words]
    return words


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def archive_member(archive_path: Path, member_name: str) -> tuple[tarfile.TarFile, BinaryIO]:
    archive = tarfile.open(archive_path, "r:bz2")
    member = archive.extractfile(member_name)
    if member is None:
        archive.close()
        raise FileNotFoundError(f"{member_name} is missing from {archive_path}")
    return archive, member


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--details", type=Path, default=DETAILS_ARCHIVE)
    parser.add_argument("--base", type=Path, default=BASE_ARCHIVE)
    parser.add_argument("--prepared", type=Path, default=PREPARED)
    parser.add_argument("--metadata", type=Path, default=METADATA)
    parser.add_argument("--attribution", type=Path, default=ATTRIBUTION)
    args = parser.parse_args()
    if not args.details.is_file() or not args.base.is_file():
        raise FileNotFoundError("Both official Tatoeba snapshot archives are required")
    if args.prepared.exists() or args.metadata.exists() or args.attribution.exists():
        raise FileExistsError("Refusing to overwrite existing Tatoeba preparation outputs")

    started = time.perf_counter()
    args.prepared.mkdir(parents=True)
    args.metadata.mkdir(parents=True)
    args.attribution.mkdir(parents=True)
    handles = {
        LANGUAGES[language_code][0]: {
            split: (args.prepared / LANGUAGES[language_code][0] / f"{split}.jsonl")
            for split in ("train", "validation", "test")
        }
        for language_code in LANGUAGES
    }
    for language_paths in handles.values():
        for path in language_paths.values():
            path.parent.mkdir(parents=True, exist_ok=True)

    stats = {
        language: {
            "iso_639_3": language,
            "language_id": LANGUAGES[language][0],
            "rows_seen": 0,
            "rows_used": 0,
            "rows_deduplicated": 0,
            "rows_rejected_token_count": 0,
            "tokens": 0,
            "unique_words": set(),
            "unique_training_authors": set(),
            "splits": {split: {"sentences": 0, "tokens": 0} for split in ("train", "validation", "test")},
        }
        for language in LANGUAGES
    }
    seen_text: dict[str, set[bytes]] = {language: set() for language in LANGUAGES}
    output_handles = {language: {split: path.open("w", encoding="utf-8", newline="\n")
                                 for split, path in paths.items()}
                      for language, paths in handles.items()}
    detail_archive = base_archive = None
    detail_stream = base_stream = None
    paired_rows = 0
    try:
        detail_archive, detail_stream = archive_member(args.details, "sentences_detailed.csv")
        base_archive, base_stream = archive_member(args.base, "sentences_base.csv")
        detail_iter: Iterator[bytes] = iter(detail_stream.readline, b"")
        base_iter: Iterator[bytes] = iter(base_stream.readline, b"")
        while True:
            detail_line = next(detail_iter, None)
            base_line = next(base_iter, None)
            if detail_line is None and base_line is None:
                break
            if detail_line is None or base_line is None:
                raise ValueError("Tatoeba detail and base exports have different row counts")
            sentence_id, language_code, text, author = parse_detail_line(detail_line)
            base_sentence_id, base_id = parse_base_line(base_line)
            if sentence_id != base_sentence_id:
                raise ValueError(f"Tatoeba export IDs do not align at row {paired_rows + 1}")
            paired_rows += 1
            if language_code not in LANGUAGES:
                continue
            counts = stats[language_code]
            counts["rows_seen"] += 1
            words = tokenize(language_code, text)
            if not 2 <= len(words) <= MAX_SENTENCE_TOKENS:
                counts["rows_rejected_token_count"] += 1
                continue
            content_hash = hashlib.sha256("\x1f".join(words).encode("utf-8")).digest()
            if content_hash in seen_text[language_code]:
                counts["rows_deduplicated"] += 1
                continue
            seen_text[language_code].add(content_hash)
            group_id = translation_group_id(sentence_id, base_id)
            split = split_for_group(group_id)
            output_handles[LANGUAGES[language_code][0]][split].write(json.dumps(
                {"document": str(group_id), "tokens": words}, ensure_ascii=False,
                separators=(",", ":")) + "\n")
            counts["rows_used"] += 1
            counts["tokens"] += len(words)
            counts["unique_words"].update(words)
            counts["splits"][split]["sentences"] += 1
            counts["splits"][split]["tokens"] += len(words)
            if split == "train":
                counts["unique_training_authors"].add(author)
    finally:
        for language_handles in output_handles.values():
            for handle in language_handles.values():
                handle.close()
        if detail_stream:
            detail_stream.close()
        if base_stream:
            base_stream.close()
        if detail_archive:
            detail_archive.close()
        if base_archive:
            base_archive.close()

    language_reports = {}
    for language, counts in stats.items():
        contributors = sorted(counts.pop("unique_training_authors"))
        (args.attribution / f"{language}.contributors.txt").write_text(
            "\n".join(contributors) + "\n", encoding="utf-8")
        counts["unique_words"] = len(counts["unique_words"])
        counts["unique_training_authors"] = len(contributors)
        language_reports[language] = counts

    report = {
        "corpus": "Tatoeba detailed sentences weekly export",
        "snapshot": "2026-11-21",
        "source_url": "https://downloads.tatoeba.org/exports/sentences_detailed.tar.bz2",
        "base_source_url": "https://downloads.tatoeba.org/exports/sentences_base.tar.bz2",
        "details_sha256": hash_file(args.details),
        "base_sha256": hash_file(args.base),
        "paired_rows": paired_rows,
        "split_method": "SHA-256 of translation-family base ID mod 100: 80/10/10; duplicate normalized token sequences kept at first ID",
        "tokenizer": "src/language/modules/{russian,german,romanian}.ts patterns and normalization; NFC input",
        "filters": {"minimum_tokens": 2, "maximum_tokens": MAX_SENTENCE_TOKENS,
                    "duplicate_policy": "deduplicate by normalized token sequence per language"},
        "languages": language_reports,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    (args.metadata / "prepare-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
