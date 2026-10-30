# Sources for ext-words.txt

Rebuild: `bash fetch.sh` (downloads into `raw/`), then `python -I build.py` and `python -I measure.py`.
Downloaded 2026-10-30. Counts come from `stats.json`. "New" means the word is not a Behnevis key (213,162 keys).
Every source is normalized the same way: lowercase, diacritics stripped, ayn/hamza marks removed, `^[a-z]+$`, length 3-12.

## 1. GeoNames Iran dump

- URL: https://download.geonames.org/export/dump/IR.zip
- License: CC BY 4.0 (credit GeoNames)
- Input: 254,985 features. Uses `name`, `asciiname` and Latin `alternatenames`.
- Dropped 604,701 all-lowercase alternates. These are vowel-less transliterations of the Persian script ("zmyn swkhth" for Zamin Sukhteh). Also dropped 528 all-caps or digit alternates (airport codes) and any string with non-Latin letters.
- 113,739 distinct tokens. A token is kept if it names at least 3 distinct features or comes from a notable feature (admin area, island, lake, airport, or a place with 1,000+ people). 3-letter tokens need at least 20 features. Notable names are also kept joined ("Shahr-e Kord" -> `shahrekord`).
- English stoplist: the top 30K words from hermitdave/FrequencyWords `en_50k` (OpenSubtitles 2018, CC BY-SA 4.0, https://github.com/hermitdave/FrequencyWords), plus a hand list of geographic and corporate words.
- After filtering: 24,411 kept, 18,794 new.

## 2. Persian given names (Wikidata)

- URL: https://query.wikidata.org/sparql (queries are in `fetch.sh`)
- License: CC0
- (a) Given names (P735) of people with Iranian citizenship (P27 = Q794): 1,306 names. 1,226 of them are real given-name items. The rest are P735 misuse, such as Satan or "types of football". A name is kept if Iranians make up at least 5% of everyone with that name on Wikidata, or at least 1% when there are 10 or more Iranians. That leaves 756 names. Their English aliases add spelling variants (1,542 alias rows before filtering).
- (b) Given-name items with language Persian (P407 = Q9168) or a Persian native label: 414 items, 937 label/alias rows.
- Multi-word strings are split, and also joined ("Mohammad Reza" -> `mohammadreza`). English words are removed from multi-word strings only.
- After filtering: 2,919 strings, 1,184 words kept, 366 new.

## 3. Wikidata Iranian entity labels (already in lab)

- Files: `lab/wd-iran.csv`, `lab/wd-iran2.csv` (Wikidata, CC0)
- 896 rows, 526 distinct labels, 688 tokens. Corporate words and the English top-30K are removed. 430 kept, 181 new.
- Caveat: the Iranian brands in `brands.csv` come from these labels. Words from this source match those brands by construction, so `measure.py` also reports coverage without this source.

## Output

- `ext-words.txt`: 19,285 new words (3 letters: 64, 4: 1,173, 5: 3,880).
- `ext-by-source.tsv`: the same words with the source(s) each came from.
