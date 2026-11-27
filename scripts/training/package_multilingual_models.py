#!/usr/bin/env python3
"""Stage selected, licensed language models into tracked runtime assets.

This script only copies the selected model files and attribution metadata. It
refuses to overwrite existing destinations and never copies sentence corpora.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "local-corpora/tatoeba/snapshot-2026-11-21"
EVALUATION = SNAPSHOT / "evaluation/validation-test.json"
PREPARATION = SNAPSHOT / "metadata/prepare-report.json"
ATTRIBUTION = SNAPSHOT / "attribution"
SOURCE_RECORD = ROOT / "scripts/corpus/multilingual-sources.json"
DESTINATION = ROOT / "src/prediction/data/multilingual"
LANGUAGES = ("ru", "de", "ro")
ISO_CODES = {"ru": "rus", "de": "deu", "ro": "ron"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation", type=Path, default=EVALUATION)
    parser.add_argument("--preparation", type=Path, default=PREPARATION)
    parser.add_argument("--models", type=Path, default=SNAPSHOT / "models")
    parser.add_argument("--attribution", type=Path, default=ATTRIBUTION)
    parser.add_argument("--destination", type=Path, default=DESTINATION)
    args = parser.parse_args()
    for path in (args.evaluation, args.preparation, SOURCE_RECORD):
        if not path.is_file():
            raise FileNotFoundError(path)
    if args.destination.exists():
        raise FileExistsError(f"Refusing to overwrite existing runtime model directory: {args.destination}")

    evaluation = json.loads(args.evaluation.read_text(encoding="utf-8"))
    preparation = json.loads(args.preparation.read_text(encoding="utf-8"))
    source_record = json.loads(SOURCE_RECORD.read_text(encoding="utf-8"))
    temp_destination = args.destination.with_name(args.destination.name + ".staging")
    if temp_destination.exists():
        raise FileExistsError(f"Refusing to overwrite staging directory: {temp_destination}")
    temp_destination.mkdir(parents=True)
    reports = {}
    try:
        for language in LANGUAGES:
            info = evaluation["languages"][language]
            config = info["selected_config"]
            source = args.models / language / config
            target = temp_destination / language
            (target / "binary").mkdir(parents=True)
            for relative in ("words.json", "manifest.json", "binary/model.ptng", "binary/context-stats.ptgs"):
                shutil.copyfile(source / relative, target / relative)

            manifest_path = target / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            prep = preparation["languages"][ISO_CODES[language]]
            file_source = next(file for file in source_record["files"] if file["name"] == "sentences_detailed.csv")
            manifest.update({
                "language": language,
                "data_license": "CC BY 2.0 FR",
                "license_url": source_record["license_url"],
                "source_corpus": "Tatoeba",
                "source_release": source_record["source_release"],
                "source_url": file_source["url"],
                "source_archive_sha256": file_source["sha256"],
                "attribution_file": "ATTRIBUTION.txt",
                "dictionary_file": "words.json",
                "training_sentences": prep["splits"]["train"]["sentences"],
                "training_tokens": prep["splits"]["train"]["tokens"],
                "evaluation_split_policy": evaluation["selection_rule"],
                "selected_validation_metrics": info["validation"][config]["metrics"],
            })
            manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                                     encoding="utf-8")

            authors = args.attribution / f"{ISO_CODES[language]}.contributors.txt"
            author_names = authors.read_text(encoding="utf-8").splitlines()
            attribution_text = "\n".join([
                f"PolyType {language.upper()} local frequency and n-gram model",
                "",
                "Source: Tatoeba community sentence contributors, weekly export snapshot 2026-11-21.",
                "Dataset: https://tatoeba.org/en/downloads",
                "License: CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/).",
                "Changes: language-specific tokenization, NFC normalization, filtering to 2-40 tokens,",
                "deduplication, translation-family train/validation/test split, and aggregation into",
                "word frequencies and n-gram counts. No source sentence text is included in this package.",
                "Contributors whose sentences occur in the training split (Tatoeba usernames):",
                *author_names,
                "",
            ])
            (target / "ATTRIBUTION.txt").write_text(attribution_text, encoding="utf-8")
            reports[language] = {
                "configuration": config,
                "assets": {relative: (target / relative).stat().st_size for relative in
                           ("words.json", "manifest.json", "binary/model.ptng", "binary/context-stats.ptgs",
                            "ATTRIBUTION.txt")},
                "validation": info["validation"][config]["metrics"],
                "test": info["test"]["metrics"],
            }
        args.destination.parent.mkdir(parents=True, exist_ok=True)
        temp_destination.rename(args.destination)
    except Exception:
        # The temporary directory is new output made by this invocation.
        shutil.rmtree(temp_destination)
        raise
    print(json.dumps(reports, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
