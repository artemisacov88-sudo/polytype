# Russian, German, and Romanian language data

PolyType's built-in Russian (`ru`), German (`de`), and Romanian (`ro`) modules
use derived dictionaries plus PTNG/PTGS n-gram models. They are routed through
`MultilingualPredictionProvider`; English remains on its existing provider,
and experimental OANC remains an English-only opt-in.

## Source, license, and provenance

The selected source for all three languages is the Tatoeba weekly text export,
snapshot 2026-11-21 UTC. The official Downloads page says the text sentence
exports are released under CC BY 2.0 FR. This permits reuse, modification, and
redistribution with attribution. Attribution is supplied beside each shipped
language module in `ATTRIBUTION.txt`; it identifies Tatoeba, links the license,
describes preprocessing and lists the training-split contributor usernames.
No sentence text or raw archive is included in the production package.

The exact archive URLs, release timestamps, byte sizes, SHA-256 hashes, ISO
639-3 language codes, checked date, source guidance, preprocessing rules, and
considered alternatives are recorded in `corpus/multilingual-sources.json`.
The official source cautions that community sentences and translations may
need correction, so measured quality is limited to this source domain.

## Reproducing derived data

Python's standard library is sufficient. `prepare_tatoeba.py` refuses to
overwrite its output directories. Keep all output paths fresh. It streams the
official `sentences_detailed.tar.bz2` and `sentences_base.tar.bz2` exports,
groups translations into one deterministic SHA-256 80/10/10 split, normalizes
and tokenizes each language, filters sentences outside 2–40 tokens, and
deduplicates normalized sequences. It records sorted usernames for training
sentences only. It does not access Obsidian vault notes.

The shared `build_ngrams.py` exports can be generated from the prepared train
split and the resulting SQLite database. Use fresh database/output paths; the
training command replaces an existing database at its `--database` path.
The model packager uses the validation-selected configuration and refuses to
overwrite `src/prediction/data/multilingual`. It copies only the dictionary,
manifest, PTNG, PTGS, and attribution files, never prepared sentence data.

## Validation snapshot

Evaluation uses deterministic reservoir samples of up to 10,000 target-word
positions per split (seed 7007) and the runtime provider implementation.
Configuration is chosen by validation Top-5 accuracy, with smaller model size
as a tie-break; each selected model is then evaluated once on test. The exact
training database and split paths are recorded in the local evaluation report.
The 2026-11-21 test snapshot reports:

| Language | Test coverage | Candidate recall | Top-5 accuracy | Dictionary + PTNG + PTGS |
| --- | ---: | ---: | ---: | ---: |
| Russian | 99.98% | 94.28% | 78.44% | 33,058,135 bytes |
| German | 99.98% | 95.61% | 84.40% | 26,383,689 bytes |
| Romanian | 99.78% | 94.60% | 84.64% | 2,098,258 bytes |

These results use Tatoeba sentence text and are not a benchmark of general
Obsidian prose. Romanian's training sample is substantially smaller than the
Russian and German samples. Runtime behavior and memory use still need manual
checks in Obsidian Desktop and Mobile.

## Runtime loading and memory

The non-English Provider keeps one active decoded PTNG/PTGS model. A language
switch releases the prior provider and loader references; a model that failed
to load remains marked failed for the session so repeated keystrokes do not
repeat expensive reads or notices. The JSON dictionary Trie is loaded only if
the binary model is unavailable or invalid, since the healthy model already
provides full unigram frequencies and prefix candidates. Binary and context
records are validated in bounded chunks that yield to the host event loop;
size, SHA-256, ordering, bounds, and format checks remain enabled.

Run `npm run multilingual:benchmark` for a local runtime benchmark on the
checked-in assets. It reports cold load time, warm median/p95 suggestion time,
asset reads, and Node heap/external/RSS snapshots. This is a Node benchmark and
does not predict Obsidian Mobile performance.

## Alternatives checked

- Mozilla Common Voice Scripted Speech 27.0 is CC0-1.0, but its official
  downloads are large audio packages and its prompt domain is speech
  recognition rather than general written language.
- CoRoLa is accessible through official query interfaces, but its site says the
  corpus is not available for full or partial download, so it is not usable by
  this local training pipeline.
