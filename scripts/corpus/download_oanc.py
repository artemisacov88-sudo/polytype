#!/usr/bin/env python3
"""Download and verify the official Open ANC GrAF archive using stdlib only."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OFFICIAL_PAGE = "https://anc.org/data/oanc/"
RELEASE = "datasets-2026-09-25"
ARCHIVE_URL = f"https://github.com/nancyide/anc-website/releases/download/{RELEASE}/OANC_GrAF.zip"
DEFAULT_OUTPUT = ROOT / "local-corpora/oanc/raw/OANC_GrAF.zip"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_zip(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        damaged = archive.testzip()
        if damaged:
            raise RuntimeError(f"CRC failure in OANC archive member: {damaged}")


def write_metadata(path: Path, digest: str) -> dict:
    metadata = {"name": "Open American National Corpus (OANC) GrAF",
                "release": RELEASE, "official_page": OFFICIAL_PAGE, "archive_url": ARCHIVE_URL,
                "license": "The official OANC page states unrestricted use and redistribution, including commercial use, and invites derived resources.",
                "attribution": "Contains data derived from the Open American National Corpus (OANC), https://anc.org/data/oanc/",
                "archive_bytes": path.stat().st_size, "sha256": digest,
                "integrity": "ZIP CRC check passed"}
    metadata_path = ROOT / "local-corpora/oanc/metadata/oanc-source.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true", help="Replace an existing archive after a new download verifies")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists() and not args.force:
        verify_zip(args.output)
        metadata = write_metadata(args.output, sha256_file(args.output))
        print(json.dumps({**metadata, "archive": str(args.output), "already_present": True}, indent=2, ensure_ascii=False))
        return

    temporary = args.output.with_suffix(args.output.suffix + ".part")
    request = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "PolyType OANC offline trainer"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as destination:
            shutil.copyfileobj(response, destination, length=1024 * 1024)
            destination.flush()
        verify_zip(temporary)
        digest = sha256_file(temporary)
        temporary.replace(args.output)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    metadata = write_metadata(args.output, digest)
    print(json.dumps(metadata, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
