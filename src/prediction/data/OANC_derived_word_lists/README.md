# Word lists derived from the OANC

Offered to the American National Corpus project by Lingevo (https://lingevo.com).

Built from the OANC_GrAF release (September 2026), https://anc.org/data/oanc/. Built 2026-11-01.

## Licence and credit

Offered under the same terms as the OANC (unrestricted use, including commercial use). If you host or redistribute
these files, please credit: **Lingevo (lingevo.com)**. Please keep the OANC credit too:
"Contains data derived from the Open American National Corpus (OANC), https://anc.org/data/oanc/".

## What is in this zip

| File | Contents |
|---|---|
| `oanc_wordfreq_written.csv` | Lemma frequency list for written English, by part of speech and genre. 31,754 rows. |
| `oanc_wordfreq_spoken.csv` | Word frequency list for spoken English (word forms, not lemmas). 11,155 rows. |
| `oanc_collocations.json` | Word-partner (collocation) statistics for 6,323 headwords, by part of speech. |
| `build_oanc.py` | The Python script that builds all of the above from the OANC text. |

## Which texts were used

- **Written (frequency list and word partners):** Slate (genre `magazine`), Verbatim and the OUP non-fiction essays
  (`academic`), Berlitz travel guides (`travel`), the government web pages and the 9/11 Commission report
  (`government`), the Eggan serial novel (`fiction`) and the ICIC fundraising letters (`letters`).
  Left out: the biomedical journals (BioMed Central, PLOS).
- **Spoken (spoken frequency list only):** Switchboard telephone conversations and the Charlotte face-to-face
  conversations.
- Sentences were re-joined from the hard-wrapped text, de-duplicated, and filtered to remove obvious garbage
  (very short or very long sentences, stray symbols, odd punctuation). About 3.9 million written tokens were counted.
  Proper nouns, numbers and punctuation are not counted.

## File formats

**`oanc_wordfreq_written.csv`**: `lemma, pos, count, per_million, genres_present, n_magazine, n_academic, n_travel,
n_government, n_fiction, n_letters`. `pos` is one of NOUN, VERB, ADJ, ADV, PREP, DET, PRON, CONJ, MODAL, PART, INTJ, EX.
`per_million` is out of all counted tokens. `genres_present` is how many of the six genres contain the word.
Rows with fewer than 3 occurrences are left out.

**`oanc_wordfreq_spoken.csv`**: `word, count, per_million`. Lower-case word forms. Includes transcription fillers
such as "uh" and "um-hum". Words seen fewer than 5 times are left out.

**`oanc_collocations.json`**: `{"meta": {...}, "entries": {lemma: {POS: {"freq": n, relation: [[partner, count, logDice], ...]}}}}`.
Relations by headword type:
- noun: `adj` (adjective before it), `verb` (verb it is the object of), `noun_before`, `noun_after`, `prep_after`
- verb: `noun_object`, `adv`, `prep_after` (includes particles, so phrasal verbs appear)
- adj: `noun`, `adv`, `prep_after`
- adv: `adj`, `verb`

Partners are ranked by logDice = 14 + log2(2 * f(xy) / (f(x) + f(y))). Each pair needs at least 3 occurrences, each
headword at least 25. The top 15 partners per relation are kept. Example: `entries["decision"]["NOUN"]["verb"]`
starts with `make`, `appeal`, `delay`.

## Method and limits

- Sentences split with NLTK's Punkt model. Words tagged with NLTK's averaged perceptron tagger. Lemmas come from
  rules plus a corpus vocabulary check, with a table of irregular verbs and nouns. Nothing is hand-checked, so expect
  tagging and lemma errors.
- Relations are surface patterns: adjective directly before a noun; verb followed by up to three determiners,
  adjectives or numbers and then a noun; noun directly before a noun; adverb directly next to an adjective or verb;
  and a verb, adjective or noun directly followed by a preposition or particle.
- A rough check against an academic collocation list of 2,813 pairs found 43% of them in the top 15 partners
  (49% where the headword occurs in our counts). It is general-purpose, so it is weaker on academic phrases.
- The counted text is about 3.9 million tokens, so counts for rare words are small. Treat counts under about 10 with care.

## Rebuilding

`build_oanc.py` is deterministic (two runs give identical files). It needs Python 3 and NLTK with the
`averaged_perceptron_tagger` and `punkt_tab` data. Put it in a folder that contains the extracted OANC text at
`text/OANC-GrAF/data/` (the `.txt` files from OANC_GrAF.zip) and run `python build_oanc.py`. The output files are
written to the folder above it. A full build takes under a minute.
Without optional `ngsl.json`, `nawl.json` and `tsl.json` word lists it skips one extra output and still builds the rest.
