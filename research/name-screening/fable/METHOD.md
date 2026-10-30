# Brand-potential ranking of 5-letter .com names

Regenerate: `cd lab/fable && bun rank.ts` (about 20 to 35 s). Reads
`../voting-copy.db` read-only, `../behnevis/combined_tables.js`, `../brands.csv`,
`../finglish-ext/ext-by-source.tsv` (optional) and `data/raw/words_alpha.txt`
(public English word list from github.com/dwyl/english-words, fetched once).

## What "brand potential" means here

The question is only about the name. I split it into two layers.

**Layer 1 is a gate.** A Persian reader can read and say the name without effort,
and a non-Persian reader will not trip on the spelling. The brief made this the one
fixed rule, so it is pass or fail, not a score. A name passes if:

- it uses only letters with one stable reading in Finglish: no `c` (except `ch`),
  `q`, `w`, `x`, `th`, `ph`;
- it has no tripled letter and no doubled letter at the start;
- its vowels group into nuclei Persian has: single vowels, long `aa ee oo`, the
  diphthongs `ei ou ai`, or the two-syllable pairs `ia io` (as in Kia). Any other
  pair (`ea ue ui oa ...`) or three vowels in a row fails;
- it syllabifies as Persian (C)V(C)(C): at most one consonant before the first
  vowel, at most two at the end, at most two between vowels. Persian speakers say
  "esnap" for Snapp, which is why initial clusters fail. A two-consonant cluster counts as legal only if it occurs in at
  least 40 of the 213K Behnevis Finglish dictionary keys (83 legal final clusters,
  280 legal medial ones). Three medial consonants always fail; Persian only has
  them across a suffix boundary, as in band-ha;
- it does not start with an entry on a short blocklist of vulgar or grim Persian
  words (khay-, kir-, kos-, koon-, marg-, ...). The previous ranking's top name was
  one of these.

292,532 of 2,338,250 names (12.5%) pass. Rejections: 1.06M for a bad letter, 379K
for a vowel pair, 194K final cluster, 149K medial cluster, 138K initial cluster,
112K vowel run, 7K initial double, 6K triple, 300 blocklist.

**Layer 2 is a score.** It asks how much the name looks like a brand that works in
both worlds. Five parts, summed with hand-set weights:

| part | weight | what it is |
|---|---|---|
| `fing` | 1.0 | Character trigram model trained on Behnevis Finglish keys, mean log2 probability per letter. Scaled so the passing-pool median is 0 and the 75th percentile of real 5-letter Finglish words is 1, then clipped. Above that it saturates on purpose: a common word is not better than an equally plausible coinage. |
| `eng` | 0.8 | Same model trained on 370K English words, scaled the same way against real 5-letter English words. This is the "international" axis: does the spelling read naturally to everyone else. |
| `intl` | 1.0 | 1 minus penalties for things a non-Persian reader mispronounces or finds foreign: `kh gh zh` 0.35 each, final `e` 0.3 (silent in English, "eh" in Persian), `ou` 0.25, `ei` and `aa` 0.15, `ai` 0.1, final consonant cluster 0.15, medial cluster 0.05, consonant + final `h` 0.2, final `j` 0.1. |
| `syl` | 0.4 | 2 syllables 1.0, 3 syllables 0.75, 1 syllable 0.5. |
| `distinct` | 0.4 | 5 distinct letters 1.0, 4 letters 0.8, 3 letters 0.3. |

Maximum is 3.6. Ties (both language models saturated) break on the raw, unclipped
sum of the two model scores.

Why not the earlier Finglish-only rank. Finglish plausibility alone measures how much
a string is a Persian word, so its top is common vocabulary such as khaye, khaan and
maneh, some with ugly meanings, and heavy in `kh` and `gh` that no one outside Iran
can say. Brands like Snapp, Divar, Torob, Okala, Balad are Persian-readable but
also simple in English spelling. The gate handles readability; the English model
and the `intl` penalties handle the second half of the brief.

I tried a CV-skeleton prior learned from the 115 passing 5-letter brands and dropped
it. Digraphs and long vowels collapse different shapes into one skeleton, and 115 is
too few, so it rewarded artefacts. Every `-io` and `-ia` name rose to the top.

## Outputs

- `all-pass.csv`: all 292,532 passing names with every score, ranked.
- `top10k.csv`: first 10,000 of the raw rank.
- `top1k.csv`: walk down the raw rank keeping at most 4 names per leading
  trigram and 4 per trailing trigram, stop at 1,000. The `rank` column is the raw
  rank, so the cap is visible.
- `validation.json`: every number below.

Columns: `rank name score fing eng intl syl skel distinct flags fa en src sum avail
price_usd`. `fa` is the Persian spelling if the name is a Behnevis key, `en` marks
an English dictionary word, `src` marks a Persian place or given name from
`finglish-ext`, `sum` is the ASCII sum, `avail` and `price_usd` come from the pool.

## What I measured

Gate pass rate and score percentile within the passing pool (100 = best), by group:

| group | n | pass gate | median percentile | share in top 10% |
|---|---|---|---|---|
| Iranian brands, all lengths (`brands.csv`) | 112 | 84.8% | 98.2 | 74% |
| Iranian brands, 5 letters | 42 | 34 pass | 98.2 (Finglish-only: 96.2) | |
| Global brands, all lengths (Wikidata) | 456 | 47.6% | 89.6 | 49% |
| Persian place and given names, 5 letters (`finglish-ext`) | 3,880 | 80.6% | 91.2 | 53% |
| English 5-letter words | 15,921 | 48.3% | 93.5 | 61% |
| Uniform random 5-letter strings | 11,643 | 5.5% | 49.2 | 11% |

Real Iranian brands almost all pass and sit at the top; random strings
mostly fail and the survivors sit in the middle; global brands and English words
split about half and half, which is the intended "international but Persian-safe"
cut. The random-string line is the only true negative control; everything else is
a mix.

The 17 Iranian brands that fail the gate, by reason. Initial cluster: snapp, blu.
Medial cluster `ps`, `pn`, `tp`, `jv`: tapsi, mapna, bitpin, lajvar. Letters c, q,
w, x: hepco, hiweb, ikco, sapco, solico, qeshm, wallex, snowa. Final cluster: arj,
ayk. Initial double: aabsal. Of the 34 passing 5-letter Iranian brands, the lowest
percentiles are ofogh 28.9 (the `gh`), fanup 59.1, eitaa 65.2 (`aa` and `ei`),
saipa 66.7, okala 73.6.

Composition of the top 1,000: 25% are Behnevis words, 15% English dictionary words,
4% Persian place or given names, 0% contain kh/gh/zh, 93% two syllables, 72% CVCVC.
ASCII sum median 531, only 4% in the 550 to 555 band the earlier session looked at.
None are `avail = free`; 245 of the top 10K carry a listed price, mean about $100K.

## Known failure modes

- **Meaning is invisible.** The score knows nothing about what a word means in
  Persian, Arabic, Turkish or English. `hated` and `ashed` are in the top 60 because
  they spell well. The `fa` and `en` columns and the blocklist are the only help;
  a human pass over the top 1K is needed.
- **Snapp-type names fail the gate.** Initial clusters (sn-, bl-, br-), `c`, `w`,
  `x` and rare medial clusters (tapsi) are out by rule. 15% of the Iranian brand list
  and 52% of global brands fail this way. The gate is deliberately strict because
  the brief made Persian ease a fixed rule.
- **Sameness at the top.** Two trigram models both like the modal letters, so the
  raw top is heavy in m, b, t, r, n, d and in `-in`, `-an`, `-ed`, `-id` endings.
  The trigram cap in `top1k.csv` spreads it; it does not fix it. Names with k, g,
  z, j, v, p, f, y, sh, ch (Zarin, Okala, Jabama, Fidibo) sit a little lower than
  they should.
- **Short English-looking words rank with Persian ones.** With `eng` at 0.8, an
  English word that is Persian-legal (sedan, satin, megan) scores like a Persian
  name. Lower `W.eng` in `rank.ts` if that is not wanted.
- **Behnevis keys are a loose spelling corpus.** They include misspellings and
  non-Persian words, and their spelling habits (`oo`, `ee`, `aa`) set what the
  Finglish model finds normal.
- **The Iranian brand list is unverified.** The earlier session wrote it from
  memory, and 115 five-letter brands is too few to learn shape from, which is why
  no part of the score is fitted to it. Weights are hand-set; I checked them against
  the groups above but did not tune them, so the percentiles are not inflated by
  fitting.
- **The English word list is the dwyl list.** It includes many obscure words, so
  `en = 1` does not mean "common English word", and the English model is more
  permissive than a frequency-weighted one would be.
