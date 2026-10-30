"""Coverage of Iranian brands and random-string noise: Behnevis vs Behnevis+ext.

Run after build.py:  python -I measure.py
"""
import csv, random, re, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
sys.stdout.reconfigure(encoding="utf-8")

keys = set(re.findall(r'"([a-z]+)":"', (LAB / "behnevis" / "combined_tables.js").read_text(encoding="utf-8")))
src = {}
for row in csv.DictReader((HERE / "ext-by-source.tsv").open(encoding="utf-8"), delimiter="\t"):
    src[row["word"]] = row["sources"].split(",")
ext = set(src)
ext_no_wd = {w for w, s in src.items() if s != ["wdlabels"]}  # wd labels are where the brand list came from
both = keys | ext

brands = [r["name"] for r in csv.DictReader((LAB / "brands.csv").open(encoding="utf-8")) if r["iran"] == "1"]
b_keys = [b for b in brands if b in keys]
new_hits = [b for b in brands if b not in keys and b in ext]
new_hits_no_wd = [b for b in new_hits if b in ext_no_wd]
print(f"Iranian brands: {len(brands)}")
print(f"  Behnevis alone:             {len(b_keys)}")
print(f"  Behnevis + ext:             {len(b_keys) + len(new_hits)}  (+{len(new_hits)})")
print(f"  Behnevis + ext minus wd-labels-only words: {len(b_keys) + len(new_hits_no_wd)}  (+{len(new_hits_no_wd)})")
print("  newly matched:", ", ".join(f"{b}[{'+'.join(src[b])}]" for b in new_hits))
print("  still missing:", ", ".join(b for b in brands if b not in both))

N5 = 26 ** 5
for seed in (1, 2, 3):
    rng = random.Random(seed)
    sample = ["".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5)) for _ in range(2000)]
    hk = sum(s in keys for s in sample)
    hb = sum(s in both for s in sample)
    print(f"noise seed={seed} 2000 random 5-letter: Behnevis {hk}, Behnevis+ext {hb}")
k5 = sum(len(w) == 5 for w in keys)
b5 = sum(len(w) == 5 for w in both)
print(f"exact 5-letter density: Behnevis {k5}/{N5} = {k5 / N5:.4%} (expect {2000 * k5 / N5:.1f} per 2000); "
      f"Behnevis+ext {b5} = {b5 / N5:.4%} (expect {2000 * b5 / N5:.1f} per 2000)")
rng = random.Random(0)
big = ["".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5)) for _ in range(200000)]
print(f"200K sample: Behnevis {sum(s in keys for s in big)}, Behnevis+ext {sum(s in both for s in big)}")

lens = Counter(len(w) for w in ext)
print(f"ext words: {len(ext)}; len3 {lens[3]}, len4 {lens[4]}, len5 {lens[5]}")
print("by source (new words):", dict(Counter(s for v in src.values() for s in v)))
