# PolyType

PolyType is an Obsidian plugin for local typing suggestions and spelling
assistance in English, Russian, German, and Romanian.

## Features

- Suggests words as you type, with manual or automatic language selection.
- Highlights likely spelling mistakes and offers local suggestions.
- Optional personal learning and a personal spelling dictionary. Personal
  learning is off by default; its data is stored locally in the vault.
- Runs locally and does not send note text to an external service.

## Manual installation

Download the full `PolyType-<version>.zip` asset from the project's GitHub
Release and extract its contents into:

```text
<vault>/.obsidian/plugins/polytype/
```

The folder must contain `main.js`, `manifest.json`, `styles.css`, and the
`data/` directory. Then enable PolyType under **Settings → Community plugins**.

The full ZIP is currently required because PolyType uses separate local data
files. Installation through Obsidian's Community plugin browser is not yet
available.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The build produces the plugin files and validates the bundled language data.
Some OANC integration tests use optional local model files; the test runner
reports a skip when those files are not present.

## Data attribution

Russian, German, and Romanian language data is derived from Tatoeba and
licensed under CC BY 2.0 FR. See the `ATTRIBUTION.txt` files under
`src/prediction/data/multilingual/`.

English frequency and collocation data is derived from the Open American
National Corpus. The packaged data includes
`data/english-ATTRIBUTION.txt`; see
[`src/prediction/data/OANC_derived_word_lists/README.md`](src/prediction/data/OANC_derived_word_lists/README.md)
for source and attribution details.

## License

Unless otherwise noted, PolyType source code is licensed under GNU GPL
version 3 or (at your option) any later version. Bundled datasets retain their
own licenses and attribution notices.

Copyright (C) 2026 artemisacov88-sudo.
