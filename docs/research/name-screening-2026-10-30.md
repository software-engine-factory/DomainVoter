# Name screening: how the 5-letter pool was split (2026-10-30)

Persian version: [name-screening-2026-10-30.fa.md](name-screening-2026-10-30.fa.md).

## Result

The 2,338,250 five-letter .com names in the pool were split into three lists that add up to the whole set:

| List | Names | Meaning |
| --- | --- | --- |
| Pass | 566,120 | A Persian reader can say it, by Persian rules, by Snapp-style rules or by English rules |
| Rejected | 1,770,404 | Breaks all three sets of rules |
| Banned | 1,726 | Contains an offensive English or Persian word (taken out of the rejected list) |

The rejected list is not final. It still holds some good names. A review page shows every rejected name as a voter card, best-sounding first, so they can be picked by hand and saved as exceptions.

All work ran on a read-only copy of the 2026-10-28 backup (`quick-brand/data/forsale/backup-final-2026-10-28/domainvoter-app/voting.db`). Nothing in the app or in production was changed. The scripts are now in `scripts/screen/` and `research/name-screening/`.

## The goal

Find names in the pool that could carry a big Iranian brand, on the scale of Snapp. The name itself is what counts, not the business. One rule is fixed. A Persian reader must not find the name foreign or hard to say, and it should still work outside Iran.

## Steps, in order

### 1. ASCII sum (dropped as a filter)

The first idea was to add up the character codes of each name and look at the curve. The sums form a bell shape from 486 to 606 (mean 543.7). The band 550 to 555 holds 289,518 names.

Iranian brands sit lower on that curve, mostly 500 to 556, because Persian names use a lot of a, h and b. But 71% of well-known brands land in the middle band (526 to 563), close to the 75% of all pool names that sit there. The sum says nothing about whether a name is good, so it was not used to filter.

### 2. Reference brands

To have something to test against, I collected about 570 brand names of 3 to 6 letters:

- Global: companies and brands from Wikidata, ranked by how many Wikipedias cover them.
- Iranian: Iranian businesses from Wikidata, plus a hand-written list of well-known Iranian consumer brands. I wrote that list from memory and nobody has verified it.

These lists are only used to check whether a method works. Their own names are not in the pool.

### 3. How Persian does a name look (Finglish score)

[Behnevis](https://behnevis.com) turns Finglish into Persian. Its page ships a dictionary of 213,162 Finglish words to every visitor. A small statistical model learned from those words which letters tend to follow which, and scores any name by how closely it matches real Finglish. Two rules were added: no letter three times in a row, and no two consonants at the start except sh, kh, ch, gh and zh.

Tested on Iranian brands the model never saw, a brand scores higher than a random pool name about 85% of the time. For global brands the figure is 83%. Training on 10,000 words or on all 208,000 gave nearly the same result, so more words do not help.

### 4. Brand-shape score (tried, dropped)

A second score compared each name with Iranian brands on vowel and consonant pattern, first and last letter, letter variety and position on the ASCII curve. On brands it had not seen, it did no better than the Finglish score alone (84.1% against 84.6%). About 110 reference brands are too few to learn this.

### 5. Extra Persian words

A separate pass built 19,285 more Finglish words from free sources: Iranian place names (GeoNames), Persian first names and Wikidata labels. It raised dictionary coverage of the Iranian brands from 65 to 73 of 112, but did not improve the Finglish score (87.4% against 87.7%).

### 6. Sayability rules (Fable)

I gave a separate agent, Fable 5.1, the goal and the earlier work as background. It built its own method:

- Hard rules: only letters with one clear Finglish reading (no q, w or x, no c except in ch, no th or ph), Persian syllable shapes, and consonant pairs that appear in at least 40 Behnevis words.
- A score: how Persian it looks, how English it looks (learned from 370,000 English words), penalties for sounds that are hard for non-Persian readers (kh, gh, zh), two syllables, and five different letters.

This passed 292,532 names (12.5%). Snapp, Tapsi, Mapna and Blu fail these rules, and those were exactly the names we were after.

### 7. Snapp-style rules

To let names like Snapp in, the rules were loosened only where real Iranian brands break them:

| Allowed | Brands that do it |
| --- | --- |
| c as a hard k (not before e, i or y) | hepco, sapco, ikco |
| w and x | snowa, hiweb, wallex |
| s+consonant or consonant+l/r at the start | snapp, blu |
| any two consonants in the middle | tapsi, mapna, bitpin |
| a doubled final consonant | snapp |

### 8. English rules

The last addition lets a name pass if it can be said by English rules. The script learned these from 370,000 English words the same way it learned the Persian ones from Behnevis, by counting which starts, endings and vowel pairs are common. The name also has to look at least as English as the bottom 10% of real English five-letter words. th, ph, q and three consonants in a row stay banned. Spellings that English and Persian readers may say differently (soft c, vowel pairs like ea or ou, a silent final e) are kept and marked.

So a name passes if it meets the Persian, the Snapp-style or the English rules. That gives the 566,120 names in the pass list.

Checks on the final rule:

| Group | Pass |
| --- | --- |
| Iranian 5-letter brands | 41 of 42 (only qeshm fails, because of q) |
| Global brands | 74% |
| English 5-letter words | 86% |
| Persian place and first names | 86% |
| Random 5-letter strings | 10% |

### 9. Banned words

Offensive names were moved out of the rejected list into their own file. English words come from the LDNOOBW list (CC BY 4.0). The Persian list from the same project is in Persian script, so it was turned into Finglish spellings through the Behnevis dictionary, and the short Persian blocklist from step 6 was added. Three-letter words only count from a short list (for example ass, kir, kos), because looser matching caught harmless names like kasra and titan. 1,115 names in the pass list also match a banned word. They are still in the pass list.

### 10. Review page

`research/name-screening/out/open/rejected-cards.html` shows all 1,770,404 rejected names as voter cards in the app's style. Cards are sorted so the names that sound most like Persian or English come first. Clicking a card bookmarks it in the browser. The bookmarks are meant to become exceptions that move names from rejected to pass.

## What this does not do

- It does not judge meaning. A name can pass and still mean something bad or silly. The pass list marks known Persian and English words so they are easy to check.
- The weights in the score were set by hand, not tuned.
- Only 5-letter names were screened. The 3- and 4-letter names in the pool were not.
- The reference brand lists are small, and the Iranian hand-written list is unverified.

## Data sources and licences

| Source | Use | Licence |
| --- | --- | --- |
| Behnevis dictionary | Finglish model and Persian banned words | Their data, copied from their public page. Used locally only. Ask them before shipping it in a product. |
| English word list (words_alpha) | English model and English rules | Public domain |
| GeoNames Iran | Extra Persian words | CC BY 4.0 |
| Wikidata | Brand lists, names | CC0 |
| LDNOOBW | Banned words | CC BY 4.0 |

## Files

The pipeline is in `scripts/screen/`. Its inputs, outputs and the exploration scripts are in `research/name-screening/`, whose [README](../../research/name-screening/README.md) lists the steps and the inputs that are not in git.

| File | What it is |
| --- | --- |
| `scripts/screen/rank.ts` | The screening script. `SCREEN_DB=<backup> TIER=open bun scripts/screen/rank.ts` gives the final lists |
| `scripts/screen/forbidden.ts` | Moves banned names out of the rejected list |
| `scripts/screen/build-cards.ts` | Builds the review page |
| `scripts/screen/export-categories.ts` | Builds the file the release applies to the pool |
| `scripts/ops/screen-apply.ts` | Sets the three collections in the database (bundled for the release) |
| `research/name-screening/out/open/` | `pass.csv`, `rejected.csv`, `forbidden.csv`, the review page (not in git) |
| `research/name-screening/fable/METHOD.md` | Fable's own method notes |
