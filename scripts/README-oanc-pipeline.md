# OANC training experiments

PTNG/OANC is experimental and is not the normal prediction model. The standard
English provider remains dictionary-backed for EditorSuggest; it is not
silently switched to OANC, and OANC PTNG/PTGS assets are not in the production
package. Separately licensed Russian, German, and Romanian PTNG/PTGS assets
are included as language modules and are described in
`README-multilingual-pipeline.md`.

## Opt-in use and fallback

- The **Experimental OANC model** setting is the opt-in for English
  EditorSuggest predictions. It remains disabled by default, reads manually
  placed PTNG/PTGS assets, and falls back to the standard Dictionary provider
  if they are unavailable or invalid. Personalization wraps whichever
  baseline the user selected.
- The **Compare experimental OANC Binary predictions at cursor** command is a
  separate diagnostic. It compares the normal provider with the experimental
  model when invoked; it does not enable or persist experimental predictions.
- Do not add the large experiment files to the normal package automatically.

Training is offline and does not affect the Obsidian runtime or normal Provider.

## Source and privacy

`local-corpora/` and `data/experiments/` are ignored by Git. The raw archive is fetched only from the download linked by the official ANC OANC page. The official page describes the OANC as unrestricted for use and redistribution (including commercial use) and explicitly invites derived word lists, frequency lists, and bigram lists. Generated distributions should retain the attribution in `local-corpora/oanc/metadata/oanc-source.json`.

Current source release: OANC GrAF, release `datasets-2026-09-25`.

## Pipeline

1. `npm run oanc:download` fetches the official GrAF release with Python's standard library, verifies ZIP CRCs, and records size/SHA-256/license provenance. It validates an existing archive and will not replace it unless `-- --force` is supplied. `npm run oanc:prepare` extracts the archive, reads the stand-off `-s.xml` sentence/utterance regions, tokenizes with the same word pattern and lowercase behavior as `src/language/modules/english.ts`, and creates document-level deterministic train/validation/test JSONL splits. Preparation metrics and source SHA-256 are written under ignored `local-corpora/oanc/metadata/`.
2. `npm run oanc:train` streams training sentences into a local SQLite aggregation database, then exports full, moderate (`count >= 2`, up to 50 continuations per context), and compact (`count >= 3`, up to 20 continuations) JSON and versioned binary experiments. The full configuration has no pruning.
3. `npm run oanc:benchmark -- data/experiments/compact` benchmarks JSON and binary in separate Node processes. It reports disk size, load time, lookup time, post-load heap, peak RSS, and checks that both exports produce the same index. Run the command for `full`, `moderate`, and `compact` for the comparison table.
4. `npm run oanc:evaluate -- --split validation --tune-ranking --pruning-config moderate` samples up to 10,000 document-held-out validation examples and compares Trie, Trie+unigram, longest-context backoff, interpolated absolute discount, unified ranking, and collocation ranking. Tuning is accepted only on validation. After fixing parameters, run `npm run oanc:evaluate -- --split test --pruning-config moderate ...` once for the final comparison. Test results are not used to select weights. Prefix and context length slices are included. IAD estimates all denominators/type counts from unpruned training data and candidate generation alone observes pruning.

The model format uses magic `PTNG`, little-endian version and per-order record counts, a length-prefixed UTF-8 vocabulary, and sorted records containing order, word IDs, and counts. The moderate experiment also exports `PTGS` full train-only unigram/context totals and continuation type counts. Pruned counts are never used as full context totals: retained mass is discounted, and all omitted mass is backed off. The manifest contains SHA-256 checksums for both assets; loaders validate hashes, IDs, counts, lengths, versions, sorted records, and trailing bytes. Experimental data is not imported into the production package.

## Obsidian integration

The **Experimental OANC model** setting is the only way to opt the normal
EditorSuggest path into the binary provider. It is disabled by default, applies
only to English, and is persisted in plugin settings. When enabled, the loader
reads these files from the plugin directory through Obsidian's Vault Adapter:

- `data/experiments/moderate/binary/model.ptng`
- `data/experiments/moderate/binary/context-stats.ptgs`
- `data/experiments/moderate/manifest.json`

Copy all three files into that relative directory in the installed plugin
folder. The production build does not copy or package them. Missing, invalid,
or incompatible model files leave ordinary `DictionaryPredictionProvider`
predictions available; the experimental loader reports a model error once
until a later load succeeds.

The **Compare experimental OANC Binary predictions at cursor** command remains
a separate diagnostic. It compares the dictionary baseline with longest
context and IAD results only when invoked; it does not toggle or persist the
EditorSuggest setting.

## Notes

- Python 3 uses only its standard library (including SQLite); no Python packages are installed.
- OANC provides sentence boundaries as stand-off GrAF annotations; punctuation is retained until boundaries are read. A deterministic punctuation splitter is used only for a document lacking a usable sentence annotation.
- The generation database lives under ignored local-corpora; the checked-in scripts do not embed or send corpus text anywhere.
- Format benchmarks describe the current Node runtime, not Obsidian's embedded Electron/WebView. Vault Adapter binary loading still needs a later Obsidian integration experiment before choosing the production format.
- The training/evaluation split is by relative document path using SHA-256, so records from one document cannot cross splits and the output is repeatable.
