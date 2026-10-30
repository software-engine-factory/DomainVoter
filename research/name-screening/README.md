# Name screening research

How the 5-letter pool was split into prefiltered, rejected and banned names. The full story, in English and Persian, is in [docs/research/name-screening-2026-10-30.md](../../docs/research/name-screening-2026-10-30.md).

The pipeline that feeds the app is in `scripts/screen/`. This folder holds its inputs and the exploration that led to it.

## Pipeline

Run from the repo root, against a backup of the production database (it is opened read-only):

```sh
SCREEN_DB="D:/K Studio/backups/dvote/<backup>/voting.db" TIER=open bun scripts/screen/rank.ts
bun scripts/screen/forbidden.ts         # moves banned names out of rejected.csv
bun scripts/screen/build-cards.ts       # review page: out/open/rejected-cards.html
bun scripts/screen/export-categories.ts # ops/release/screen-categories.tsv.gz for the release
```

The order matters: `rank.ts` rewrites `out/open/rejected.csv`.

Names picked on the review page go in `screen-exceptions.txt`, one per line. Use the page's copy button rather than retyping. `export-categories.ts` moves them from rejected to prefiltered.

## Inputs not in git

Copy these into `inputs/` before running:

| Path | Source |
| --- | --- |
| `inputs/behnevis/combined_tables.js` | `https://behnevis.com/javascript/combined_tables.js`. Their data; keep it local |
| `inputs/words_alpha.txt` | `https://github.com/dwyl/english-words` (`words_alpha.txt`, public domain) |
| `inputs/ldnoobw/` | committed (`en.txt`, `fa.txt`, CC BY 4.0) |
| `finglish-ext/raw/geonames/` | `finglish-ext/fetch.sh` |

## Exploration (kept for the record)

| Files | What it was |
| --- | --- |
| `ascii-sum.*`, `select-range.ts` | ASCII sum of every name and the bell chart |
| `brands.*`, `wd-*.csv`, `iran-curated.txt` | Reference brands and where they land on the curve |
| `finglish.ts` | First Finglish score |
| `unicorn.*` | Brand-shape score, dropped after the held-out test |
| `finglish-ext/` | Extra Persian words from GeoNames, given names and Wikidata |
| `fable/` | The Fable agent's method notes, validation and shortlists |

These scripts expect a database path argument. They used a copy of the 2026-10-28 backup, which has been deleted.
