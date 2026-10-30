"""Build ext-words.txt: Finglish proper nouns not already in Behnevis.

Run:  python -I build.py            (from any cwd; paths are relative to this file)
Reads raw/ (see fetch.sh) plus lab/behnevis/combined_tables.js and lab/wd-iran*.csv.
Writes ext-words.txt, ext-by-source.tsv, stats.json.
"""
import csv, html, json, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
RAW = HERE / "raw"
sys.stdout.reconfigure(encoding="utf-8")

MINLEN, MAXLEN = 3, 12
GEO_MIN_FEATURES = 3        # token must name >= 3 distinct GeoNames features, or ...
GEO_MIN_FEATURES_LEN3 = 20  # 3-letter tokens: >= 20 features, no notable-feature shortcut
GEO_NOTABLE_POP = 1000      # ... come from a notable feature (admin area, island, place >= 1000 people)
GEO_NOTABLE_CODES = {"PPLC", "PPLA", "PPLA2", "PPLA3", "PPLA4", "ISL", "ISLS", "LK", "AIRP"}
EN_TOP = 30000              # drop the 30K most frequent English words (multi-word strings only for given names)
GIVEN_SHARE = 0.05          # Iranian citizens / all people with the given name
GIVEN_SHARE_IF_COMMON = 0.01
GIVEN_COMMON_N = 10

# Generic words seen in GeoNames/Wikidata labels that are not in the English top-10K.
GENERIC = set("""
mount mountain mountains river rivers village villages city province provinces county district station airport
airfield lake island islands bay cape gulf strait sea hill hills peak valley desert plain plains dam port bridge road
street park mosque shrine tomb castle fort school hospital university base oil field gas well wells canal spring
springs north south east west upper lower new old central great little big small saint the and of camp farm farms mine
mines pass reservoir marsh salt rural agglomeration municipality region capital area center centre town square
power plant factory terminal border hotel tower palace garden gardens museum church cathedral international refinery
petrochemical petrochemicals industrial industries industry zone free complex house ruins ruin lagoon
company companies co inc ltd bank banks air airline airlines airways group iran iranian of the and network tv radio
television organization organisation institute agency news foundation fund corporation corp holding holdings
manufacturing services service development investment insurance steel mining engineering construction offshore
telecommunication telecommunications communications chain stores dairy food foods tires tire electric electronics
industrial publishers publishing media sport sports
""".split())


def norm(s: str) -> str:
    s = html.unescape(s).translate(str.maketrans({"ə": "e", "Ə": "e", "ı": "i", "ł": "l"}))
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[‘’ʻʼʾʿ'`´]", "", s)  # ayn/hamza marks join the word
    s = re.sub(r"\([^)]*\)", " ", s)  # "Lila (given name)" -> "Lila"
    s = re.sub(r"[·“”\"]", "", s)
    return s.lower()


def tokens(s: str):
    n = norm(s)
    if re.search(r"[^\x00-\x7f]", n):  # Arabic/Cyrillic/other scripts: skip the whole string
        return []
    return [t for t in re.split(r"[^a-z]+", n) if MINLEN <= len(t) <= MAXLEN]


def joined(s: str, stop=frozenset()):
    """'Shahr-e Kord' -> 'shahrekord'; only if the name is fully Latin. Stop words are removed first
    ('Yazd Province' -> nothing to join)."""
    n = norm(s).strip()
    if not re.fullmatch(r"[a-z]+([ \-][a-z]+)+", n):
        return None
    parts = [w for w in re.split(r"[ \-]", n) if w not in stop]
    if len(parts) < 2:
        return None
    j = "".join(parts)
    return j if MINLEN <= len(j) <= MAXLEN else None


def behnevis_keys():
    src = (LAB / "behnevis" / "combined_tables.js").read_text(encoding="utf-8")
    return set(re.findall(r'"([a-z]+)":"', src))


def english_top():
    words = []
    for line in (RAW / "english" / "en_50k.txt").open(encoding="utf-8"):
        w = line.split(" ")[0]
        if re.fullmatch(r"[a-z]+", w):
            words.append(w)
        if len(words) >= EN_TOP:
            break
    return set(words)


def geonames(stop, stats):
    feat_count = Counter()
    notable = set()
    rows = names_seen = skipped_skeleton = skipped_codes = 0
    for line in (RAW / "geonames" / "IR.txt").open(encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        rows += 1
        names = {f[1], f[2]}
        for a in f[3].split(","):
            # All-lowercase alternates are vowel-less transliterations of the Persian script
            # ("zmyn swkhth" for Zamin Sukhteh): drop them.
            if a and not re.search(r"[A-Z]", a):
                skipped_skeleton += 1
                continue
            # All-caps or digit-bearing alternates are codes (ICAO/IATA "OIII", "THR"): drop them.
            if a and (not re.search(r"[a-z]", a) or re.search(r"[0-9]", a)):
                skipped_codes += 1
                continue
            if a:
                names.add(a)
        names_seen += len(names)
        toks = set()
        for nm in names:
            toks.update(tokens(nm))
        for t in toks:
            feat_count[t] += 1
        pop = int(f[14] or 0)
        if f[6] == "A" or f[7] in GEO_NOTABLE_CODES or (f[6] == "P" and pop >= GEO_NOTABLE_POP):
            notable.update(toks)
            for nm in (f[1], f[2]):
                j = joined(nm, stop)
                if j:
                    notable.add(j)
    raw = set(feat_count) | notable
    def ok(t):
        if len(t) == 3:
            return feat_count[t] >= GEO_MIN_FEATURES_LEN3
        return feat_count[t] >= GEO_MIN_FEATURES or t in notable
    kept = {t for t in raw if ok(t) and t not in stop}
    stats["geonames"] = dict(rows=rows, names=names_seen, skipped_lowercase_skeleton_alternates=skipped_skeleton,
                             skipped_code_alternates=skipped_codes,
                             distinct_tokens=len(raw), kept=len(kept))
    return kept


def given_names(stop, stats):
    wd = RAW / "wikidata"
    cit = list(csv.DictReader((wd / "given-iran-citizens.csv").open(encoding="utf-8")))
    tot = {r["gn"]: int(r["total"]) for r in csv.DictReader((wd / "given-iran-citizens-totals.csv").open(encoding="utf-8"))}
    # P735 is sometimes misused (Satan, "types of football"): keep only items that are given names.
    is_name = {r["gn"] for r in csv.DictReader((wd / "given-iran-citizens-is-given-name.csv").open(encoding="utf-8"))}
    accepted = set()
    for r in cit:
        if r["gn"] not in is_name:
            continue
        n, t = int(r["n"]), max(tot.get(r["gn"], 0), int(r["n"]))
        share = n / t
        if share >= GIVEN_SHARE or (n >= GIVEN_COMMON_N and share >= GIVEN_SHARE_IF_COMMON):
            accepted.add(r["gn"])
    labels = [r["label"] for r in cit if r["gn"] in accepted]
    labels += [r["alias"] for r in csv.DictReader((wd / "given-iran-citizens-aliases.csv").open(encoding="utf-8"))
               if r["gn"] in accepted]
    pl = list(csv.DictReader((wd / "given-persian-lang.csv").open(encoding="utf-8")))
    pl_items = {r["gn"] for r in pl}
    for r in pl:
        labels += [r["label"], r["alias"]]
    out = set()
    for s in labels:
        if not s:
            continue
        toks = tokens(s)
        # Multi-word strings ("Lord of This World", "Arabic given name") lose English words;
        # a single-word name ("Sara") is kept even if it is also English.
        out.update(toks if len(toks) == 1 else [t for t in toks if t not in stop])
        j = joined(s, stop)  # "Mohammad Reza" -> "mohammadreza"
        if j:
            out.add(j)
    stats["given_names"] = dict(citizen_given_names=len(cit), citizen_is_given_name=len(is_name & {r["gn"] for r in cit}), citizen_accepted=len(accepted),
                                persian_language_items=len(pl_items), persian_language_rows=len(pl),
                                strings=len([s for s in labels if s]), kept=len(out))
    return out


def wd_labels(stop, stats):
    labels = []
    for fn in ("wd-iran.csv", "wd-iran2.csv"):
        labels += [r["label"] for r in csv.DictReader((LAB / fn).open(encoding="utf-8"))]
    raw = set()
    for s in labels:
        raw.update(tokens(s))
    kept = {t for t in raw if t not in stop}
    stats["wd_labels"] = dict(rows=len(labels), distinct_labels=len(set(labels)), distinct_tokens=len(raw), kept=len(kept))
    return kept


def main():
    stats = {}
    keys = behnevis_keys()
    en = english_top()
    stop = en | GENERIC
    stats["behnevis_keys"] = len(keys)
    sources = {"geonames": geonames(stop, stats), "given": given_names(stop, stats), "wdlabels": wd_labels(stop, stats)}
    by_word = defaultdict(list)
    for name, words in sources.items():
        new = {w for w in words if w not in keys}
        stats[{"geonames": "geonames", "given": "given_names", "wdlabels": "wd_labels"}[name]]["new_vs_behnevis"] = len(new)
        for w in new:
            by_word[w].append(name)
    words = sorted(by_word)
    assert all(re.fullmatch(r"[a-z]{%d,%d}" % (MINLEN, MAXLEN), w) for w in words)
    (HERE / "ext-words.txt").write_text("\n".join(words) + "\n", encoding="utf-8", newline="\n")
    with (HERE / "ext-by-source.tsv").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("word\tsources\n")
        for w in words:
            fh.write(f"{w}\t{','.join(by_word[w])}\n")
    stats["ext_total"] = len(words)
    stats["ext_by_len"] = dict(sorted(Counter(len(w) for w in words).items()))
    (HERE / "stats.json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
