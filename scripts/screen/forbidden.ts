// Move offensive names out of rejected.csv into forbidden.csv (English and Persian).
// Run after `TIER=open bun rank.ts` (which rewrites rejected.csv), then rebuild the cards.
// Usage: bun scripts/screen/forbidden.ts (works in research/name-screening/out/open)
//
// Word lists:
//   en  LDNOOBW English list (CC BY 4.0), data/raw/ldnoobw/en.txt
//   fa  LDNOOBW Persian list, in Persian script, turned into Finglish through the
//       Behnevis dictionary (every Finglish key whose Persian value is a listed word),
//       plus the Persian blocklist already in rank.ts.
// Match: the name is the word, starts with it, or contains it when the word has 4+
// letters. Three-letter words only match at the start, so "bassa" is not caught by "ass".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INPUTS, OUT } from "./paths";

process.chdir(join(OUT, "open"));

const raw = (f: string) => readFileSync(join(INPUTS, `ldnoobw/${f}`), "utf8").split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
const words = new Map<string, string>(); // finglish/english word -> language
for (const w of raw("en.txt")) { const k = w.toLowerCase().replace(/[\s-]/g, ""); if (/^[a-z]{3,5}$/.test(k)) words.set(k, "en"); }

const faScript = new Set(raw("fa.txt"));
for (const m of readFileSync(join(INPUTS, "behnevis/combined_tables.js"), "utf8").matchAll(/"([a-z]+)":"([^"]*)"/g))
  if (faScript.has(m[2].trim()) && m[1].length >= 3 && m[1].length <= 5 && !words.has(m[1])) words.set(m[1], "fa");
// Same list rank.ts blocks on (vulgar or ominous in Persian).
for (const w of ["khay", "kir", "kos", "koon", "kun", "jende", "gooz", "gaei", "gayi", "sakht", "mord", "marg", "ghabr"]) words.set(w, "fa");

// Three-letter words only count from this short list: the lists' other 3-letter
// entries ("kas", "kes", "mni", "tit") are mostly innocent prefixes ("kasra", "titan").
const SHORT = new Set(["ass", "cum", "fag", "sex", "xxx", "kir", "kos", "kun", "kus", "kyr"]);
function hit(name: string): [string, string, string] | null {
  for (const [w, lang] of words) {
    if (w.length === 3 && !SHORT.has(w)) continue;
    if (name === w) return [lang, w, "exact"];
    if (name.startsWith(w)) return [lang, w, "prefix"];
    if (w.length >= 4 && name.includes(w)) return [lang, w, "contains"];
  }
  return null;
}

const lines = readFileSync("rejected.csv", "utf8").trim().split("\n");
const head = lines[0], keep: string[] = [], bad: string[] = [];
for (const line of lines.slice(1)) {
  const h = hit(line.slice(0, 5));
  if (h) bad.push(`${line.slice(0, 5)},${h.join(",")},${line.slice(6)}`); else keep.push(line);
}
await Bun.write("rejected.csv", head + "\n" + keep.join("\n") + "\n");
await Bun.write("forbidden.csv", "name,lang,word,match," + head.split(",").slice(1).join(",") + "\n" + bad.join("\n") + "\n");

// Count, don't move: offensive names that passed the gate (English profanity is not part of it).
const passHits = readFileSync("pass.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[2]).filter((n) => hit(n));
const passN = readFileSync("pass.csv", "utf8").trim().split("\n").length - 1;
const by = (l: string) => bad.filter((b) => b.split(",")[1] === l).length;
console.log(`word list: ${[...words.values()].filter((l) => l === "en").length} en, ${[...words.values()].filter((l) => l === "fa").length} fa`);
console.log(`forbidden ${bad.length} (en ${by("en")}, fa ${by("fa")}) · rejected now ${keep.length} · pass ${passN} · total ${bad.length + keep.length + passN}`);
console.log(`also matching in pass.csv (left there): ${passHits.length}: ${passHits.slice(0, 40).join(" ")}`);
