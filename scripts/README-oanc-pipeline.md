# OANC training experiments

Training is offline and does not affect the Obsidian runtime or Provider.

## Source and privacy

`local-corpora/` and `data/experiments/` are ignored by Git. The raw archive is fetched only from the download linked by the official ANC OANC page. The official page describes the OANC as unrestricted for use and redistribution (including commercial use) and explicitly invites derived word lists, frequency lists, and bigram lists. Generated distributions should retain the attribution in `local-corpora/oanc/metadata/oanc-source.json`.

Current source release: OANC GrAF, release `datasets-2026-09-25`.

## Pipeline

1. `npm run oanc:download` fetches the official GrAF release with Python's standard library, verifies ZIP CRCs, and records size/SHA-256/license provenance. It validates an existing archive and will not replace it unless `-- --force` is supplied. `npm run oanc:prepare` extracts the archive, reads the stand-off `-s.xml` sentence/utterance regions, tokenizes with the same word pattern and lowercase behavior as `src/language/modules/english.ts`, and creates document-level deterministic train/validation/test JSONL splits. Preparation metrics and source SHA-256 are written under ignored `local-corpora/oanc/metadata/`.
2. `npm run oanc:train` streams training sentences into a local SQLite aggregation database, then exports full, moderate (`count >= 2`, up to 50 continuations per context), and compact (`count >= 3`, up to 20 continuations) JSON and versioned binary experiments. The full configuration has no pruning.
3. `npm run oanc:benchmark -- data/experiments/compact` benchmarks JSON and binary in separate Node processes. It reports disk size, load time, lookup time, post-load heap, peak RSS, and checks that both exports produce the same index. Run the command for `full`, `moderate`, and `compact` for the comparison table.
4. `npm run oanc:evaluate -- --split validation --tune-ranking --pruning-config moderate` samples up to 10,000 document-held-out validation examples and compares Trie, Trie+unigram, longest-context backoff, interpolated absolute discount, unified ranking, and collocation ranking. Tuning is accepted only on validation. After fixing parameters, run `npm run oanc:evaluate -- --split test --pruning-config moderate ...` once for the final comparison. Test results are not used to select weights. Prefix and context length slices are included. IAD estimates all denominators/type counts from unpruned training data and candidate generation alone observes pruning.

The model format uses magic `PTNG`, little-endian version and per-order record counts, a length-prefixed UTF-8 vocabulary, and sorted records containing order, word IDs, and counts. The moderate experiment also exports `PTGS` full train-only unigram/context totals and continuation type counts. Pruned counts are never used as full context totals: retained mass is discounted, and all omitted mass is backed off. The manifest contains SHA-256 checksums for both assets; loaders validate hashes, IDs, counts, lengths, versions, sorted records, and trailing bytes. Experimental data is not imported into the production package.

## Obsidian comparison command

The plugin adds **Compare experimental OANC Binary predictions at cursor**. It runs only when invoked, only for English, and shows the current result beside longest-context and IAD variants. It does not change the EditorSuggest provider or save a setting. The loader reads `data/experiments/moderate/binary/model.ptng`, `data/experiments/moderate/binary/context-stats.ptgs`, and `data/experiments/moderate/manifest.json` through the Vault Adapter. These generated files are intentionally absent from production `dataFiles`; to compare in another Obsidian plugin directory, copy the Binary, context stats, and manifest. Missing or invalid assets fall back to the existing predictions.

## Notes

- Python 3 uses only its standard library (including SQLite); no Python packages are installed.
- OANC provides sentence boundaries as stand-off GrAF annotations; punctuation is retained until boundaries are read. A deterministic punctuation splitter is used only for a document lacking a usable sentence annotation.
- The generation database lives under ignored local-corpora; the checked-in scripts do not embed or send corpus text anywhere.
- Format benchmarks describe the current Node runtime, not Obsidian's embedded Electron/WebView. Vault Adapter binary loading still needs a later Obsidian integration experiment before choosing the production format.
- The training/evaluation split is by relative document path using SHA-256, so records from one document cannot cross splits and the output is repeatable.
