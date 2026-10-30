// Brand-potential ranking of 5-letter .com names for an Iranian, internationally
// scalable brand. See docs/research/name-screening-2026-10-30.md and research/name-screening/fable/METHOD.md.
// Usage: SCREEN_DB=<path to a voting.db backup> TIER=open bun scripts/screen/rank.ts   (TIER: unset = strict, loan, open)
//
// Pipeline
//   1. Hard filter: can a Persian reader read and say it without effort, and does
//      it avoid spellings that break for a non-Persian reader (c, q, w, x, th, ph).
//      Syllable structure is checked with a (C)V(C)(C) syllabifier whose legal
//      consonant clusters are learned from the Behnevis Finglish dictionary.
//   2. Soft score: Finglish plausibility (trigram model), international readability
//      penalties, English trigram plausibility, syllable count, letter variety.
//   3. Outputs: all-pass.csv (every passing name), top10k.csv (raw rank),
//      top1k.csv (raw rank with a cap per leading/trailing trigram for variety).
//   4. Validation against Iranian brands, global brands, English words, Persian
//      place/given names and random strings. Printed to stdout and saved to
//      validation.json.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INPUTS, OUT, RES } from "./paths";

const dbPath = process.env.SCREEN_DB ?? (() => { throw new Error("set SCREEN_DB to a voting.db backup (opened read-only)"); })();
const out = join(OUT, process.env.TIER === "loan" ? "loan" : process.env.TIER === "open" ? "open" : "strict");
mkdirSync(out, { recursive: true });
const t0 = performance.now();

// ---------------------------------------------------------------- inputs
const beh = readFileSync(join(INPUTS, "behnevis/combined_tables.js"), "utf8");
const dict = new Map<string, string>(); // finglish -> persian
for (const m of beh.matchAll(/"([a-z]+)":"([^"]*)"/g)) if (!dict.has(m[1])) dict.set(m[1], m[2]);

const ext = new Map<string, string>(); // finglish-ext word -> sources (optional input)
const extPath = join(RES, "finglish-ext/ext-by-source.tsv");
if (existsSync(extPath))
  for (const l of readFileSync(extPath, "utf8").split("\n").slice(1)) {
    const [w, s] = l.trim().split("\t");
    if (w && s) ext.set(w, s);
  }

type Brand = { name: string; iran: boolean };
const brands: Brand[] = readFileSync(join(RES, "brands.csv"), "utf8").trim().split("\n").slice(1)
  .map((l) => l.split(","))
  .map((c) => ({ name: c[3].toLowerCase(), iran: c[5] === "1" }))
  .filter((b) => /^[a-z]+$/.test(b.name));
const uniq = <T extends { name: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.name, x])).values()];
const iranBrands = uniq(brands.filter((b) => b.iran));
const globBrands = uniq(brands.filter((b) => !b.iran && !iranBrands.some((i) => i.name === b.name)));

const englishPath = join(INPUTS, "words_alpha.txt");
const english5 = existsSync(englishPath)
  ? readFileSync(englishPath, "utf8").split(/\r?\n/).filter((w) => w.length === 5 && /^[a-z]+$/.test(w))
  : [];

// ---------------------------------------------------------------- phonology
// Grapheme tokenizer. Digraphs sh ch kh gh zh are single consonants. y is a glide
// (consonant) next to a vowel, otherwise a vowel ("myket").
const VOWELS = new Set("aeiou");
const DIGRAPH = new Set(["sh", "ch", "kh", "gh", "zh"]);
// One nucleus (long vowel or diphthong). ia/io are two syllables (hiatus, "kia").
const VOWEL_PAIRS = new Set(["aa", "ee", "oo", "ei", "ou", "ai"]);
const HIATUS = new Set(["ia", "io"]);
// Sonority is only used to describe clusters in the output; legality is learned.
//
// TIER=loan (bun rank.ts with env TIER=loan) adds the "international Persian" names
// that Iranian brands actually use but the native gate rejects. Each relaxation is
// backed by real Iranian brands:
//   c as hard k, not before e/i/y   hepco, sapco, ikco, solico
//   w and x as consonants            snowa, hiweb, wallex
//   initial s+C and C+l/r onsets     snapp, blu
//   any two-consonant medial cluster tapsi (ps), mapna (pn), bitpin (tp), lajvar (jv)
//   word-final double consonant      snapp (pp)
// q, th, ph, triples and three-consonant clusters stay banned. Outputs go to loan/
// and every row is tagged native or loan.
const LOAN = process.env.TIER === "loan";
const LOAN_ONSETS = new Set(["s+n", "s+p", "s+t", "s+k", "s+m", "s+l", "b+l", "p+l", "k+l", "g+l", "f+l", "b+r", "p+r", "t+r", "d+r", "k+r", "g+r", "f+r"]);
type Tok = { s: string; v: boolean };
function tokenize(w: string, loan = LOAN): Tok[] | null {
  const out: Tok[] = [];
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (ch === "c") {
      if (w[i + 1] === "h") { out.push({ s: "ch", v: false }); i++; continue; }
      if (!loan || "eiy".includes(w[i + 1] ?? "")) return null; // soft c is ambiguous
      out.push({ s: "c", v: false }); continue;
    }
    if (ch === "q" || ("wx".includes(ch) && !loan)) return null;
    if ((ch === "t" || ch === "p") && w[i + 1] === "h") return null; // th, ph
    if ("skgz".includes(ch) && w[i + 1] === "h") { out.push({ s: ch + "h", v: false }); i++; continue; }
    if (ch === "y") {
      const prevV = i > 0 && VOWELS.has(w[i - 1]);
      const nextV = i + 1 < w.length && VOWELS.has(w[i + 1]);
      out.push({ s: "y", v: !(prevV || nextV) });
      continue;
    }
    out.push({ s: ch, v: VOWELS.has(ch) });
  }
  return out;
}

// Learn legal clusters from Behnevis keys: word-final CC, medial CC (coda+onset)
// and medial CCC. A cluster counts as legal if it occurs in >= MIN_KEYS keys.
const MIN_KEYS = 40;
const finalCC = new Map<string, number>(), medialCC = new Map<string, number>(), medialCCC = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
for (const w of dict.keys()) {
  if (w.length < 3) continue;
  const t = tokenize(w, false);
  if (!t) continue;
  let run: string[] = [], seenV = false;
  const flush = (atEnd: boolean) => {
    if (seenV && run.length === 2) bump(atEnd ? finalCC : medialCC, run.join("+"));
    if (seenV && !atEnd && run.length === 3) bump(medialCCC, run.join("+"));
    run = [];
  };
  for (const tok of t) {
    if (tok.v) { flush(false); seenV = true; } else run.push(tok.s);
  }
  flush(true);
}
const legal = (m: Map<string, number>, k: string) => (m.get(k) ?? 0) >= MIN_KEYS;

type Phon = { toks: Tok[]; syl: number; skel: string; initC: number; finalC: number; medMax: number; nuclei: string[]; reason?: string };
function analyze(w: string, loan = LOAN): Phon {
  const bad = (reason: string): Phon => ({ toks: [], syl: 0, skel: "", initC: 0, finalC: 0, medMax: 0, nuclei: [], reason });
  if (!/^[a-z]+$/.test(w)) return bad("non-alpha");
  if (/(.)\1\1/.test(w)) return bad("triple");
  const toks = tokenize(w, loan);
  if (!toks) return bad("letter"); // c q w x th ph
  // Group vowels into nuclei; check vowel pairs.
  const units: { c: boolean; s: string }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.v) { units.push({ c: true, s: t.s }); continue; }
    let s = t.s, j = i + 1;
    while (j < toks.length && toks[j].v) { s += toks[j].s; j++; }
    if (s.length >= 3) return bad("vowel-run");
    if (s.length === 2 && HIATUS.has(s)) { units.push({ c: false, s: s[0] }, { c: false, s: s[1] }); i = j - 1; continue; }
    if (s.length === 2 && !VOWEL_PAIRS.has(s)) return bad("vowel-pair");
    units.push({ c: false, s });
    i = j - 1;
  }
  const nuclei = units.filter((u) => !u.c).map((u) => u.s);
  if (nuclei.length === 0) return bad("no-vowel");
  // Consonant runs: before first nucleus, between, after last.
  const runs: string[][] = [[]];
  for (const u of units) {
    if (u.c) runs[runs.length - 1].push(u.s);
    else runs.push([]);
  }
  const init = runs[0], fin = runs[runs.length - 1], med = runs.slice(1, -1);
  if (init.length > 2 || (init.length === 2 && !(loan && LOAN_ONSETS.has(init.join("+"))))) return bad("initial-cluster");
  if (fin.length > 2) return bad("final-cluster");
  if (fin.length === 2 && !legal(finalCC, fin.join("+")) && !(loan && fin[0] === fin[1])) return bad("final-cluster");
  let medMax = 0;
  for (const r of med) {
    medMax = Math.max(medMax, r.length);
    // Three medial consonants are legal Persian only across a suffix boundary
    // ("band-ha"); in a five-letter brand they read as a wall of consonants.
    if (r.length > 2) return bad("medial-cluster");
    if (r.length === 2 && !loan && !legal(medialCC, r.join("+"))) return bad("medial-cluster");
  }
  if (toks[0].s === toks[1]?.s) return bad("initial-double");
  const skel = units.map((u) => (u.c ? "C" : "V")).join("");
  return { toks, syl: nuclei.length, skel, initC: init.length, finalC: fin.length, medMax, nuclei };
}

// Words a Persian reader would snicker at or find offensive, as prefix or whole word.
const BLOCK = ["khay", "kir", "kos", "koon", "kun", "jende", "gooz", "gaei", "gayi", "sakht", "mord", "marg", "ghabr"];
const blocked = (w: string) => BLOCK.some((b) => w.startsWith(b));

// ---------------------------------------------------------------- character trigram LMs
// Interpolated character trigram (as in research/name-screening/finglish.ts), returning mean log2
// probability per character. Trained twice: on Behnevis Finglish keys (does it
// read as Persian?) and on English words (does it read for everyone else?).
const A = 27, id = (c: number) => c - 96;
function trainLM(words: Iterable<string>): (w: string) => number {
  const c1 = new Float64Array(A), c2 = new Float64Array(A * A), c3 = new Float64Array(A * A * A);
  const ctx1 = new Float64Array(A), ctx2 = new Float64Array(A * A);
  let total = 0;
  for (const w of words) {
    let p2 = 0, p1 = 0;
    for (let i = 0; i <= w.length; i++) {
      const c = i < w.length ? id(w.charCodeAt(i)) : 0;
      c1[c]++; total++; c2[p1 * A + c]++; ctx1[p1]++; c3[(p2 * A + p1) * A + c]++; ctx2[p2 * A + p1]++;
      p2 = p1; p1 = c;
    }
  }
  const logp = new Float64Array(A * A * A);
  for (let a = 0; a < A; a++) for (let b = 0; b < A; b++) for (let c = 0; c < A; c++) {
    const p3 = ctx2[a * A + b] ? c3[(a * A + b) * A + c] / ctx2[a * A + b] : 0;
    const pb = ctx1[b] ? c2[b * A + c] / ctx1[b] : 0;
    logp[(a * A + b) * A + c] = Math.log2(0.6 * p3 + 0.3 * pb + 0.1 * (c1[c] / total) + 1e-9);
  }
  return (w: string) => {
    let p2 = 0, p1 = 0, s = 0;
    for (let i = 0; i <= w.length; i++) {
      const c = i < w.length ? id(w.charCodeAt(i)) : 0;
      s += logp[(p2 * A + p1) * A + c]; p2 = p1; p1 = c;
    }
    return s / (w.length + 1);
  };
}
const fingLogp = trainLM(dict.keys());
const englishAll = existsSync(englishPath)
  ? readFileSync(englishPath, "utf8").split(/\r?\n/).filter((w) => w.length >= 3 && /^[a-z]+$/.test(w))
  : [];
const engLogp = trainLM(englishAll);

// ---------------------------------------------------------------- English path (TIER=open)
// A name passes if a Persian reader can say it by Persian rules (analyze) OR by
// English rules (analyzeEng). The English rules are learned the same way the Persian
// ones are: onsets, codas, medial consonant runs and vowel runs count as legal when
// they occur in at least MIN_EN English words. On top of that the English path keeps
// guards for a Persian reader: no th, ph or q, no three consonant sounds in a row,
// and the name must read at least as English as the 10th percentile of real English
// five-letter words. Spellings with more than one English reading are kept but
// flagged (soft c, ea/ou/ie-type vowels, silent final e).
const OPEN = process.env.TIER === "open";
const MIN_EN = 50;
function unitsEn(w: string): { s: string; v: boolean }[] {
  const out: { s: string; v: boolean }[] = [];
  for (let i = 0; i < w.length; i++) {
    const two = w.slice(i, i + 2);
    if (["sh", "ch", "kh", "gh", "zh", "ck", "ng"].includes(two)) { out.push({ s: two, v: false }); i++; continue; }
    const ch = w[i];
    if (ch === "y") {
      const prevV = i > 0 && VOWELS.has(w[i - 1]), nextV = i + 1 < w.length && VOWELS.has(w[i + 1]);
      out.push({ s: "y", v: !(prevV || nextV) }); continue;
    }
    out.push({ s: ch, v: VOWELS.has(ch) });
  }
  return out;
}
type EnShape = { onset: string; coda: string; medial: string[]; nuclei: string[]; units: { s: string; v: boolean }[] };
function shapeEn(w: string): EnShape {
  const units = unitsEn(w);
  const runs: string[][] = [[]], nuclei: string[] = [];
  let cur = "";
  for (const u of units) {
    if (u.v) { cur += u.s; continue; }
    if (cur) { nuclei.push(cur); cur = ""; runs.push([]); }
    runs[runs.length - 1].push(u.s);
  }
  if (cur) { nuclei.push(cur); runs.push([]); }
  const onset = runs[0].join("+"), coda = nuclei.length ? runs[runs.length - 1].join("+") : "";
  return { onset, coda, medial: runs.slice(1, -1).map((r) => r.join("+")), nuclei, units };
}
const enOnset = new Map<string, number>(), enCoda = new Map<string, number>(), enMed = new Map<string, number>(), enNuc = new Map<string, number>();
for (const w of englishAll) {
  const s = shapeEn(w);
  if (!s.nuclei.length) continue;
  bump(enOnset, s.onset); bump(enCoda, s.coda);
  for (const m of new Set(s.medial)) bump(enMed, m);
  for (const n of new Set(s.nuclei)) bump(enNuc, n);
}
const enLegal = (m: Map<string, number>, k: string) => k === "" || (m.get(k) ?? 0) >= MIN_EN;
const eng5All = english5.map(engLogp).sort((a, b) => a - b);
const EN_FLOOR = eng5All[Math.floor(eng5All.length * 0.1)];
function analyzeEng(w: string): Phon {
  const bad = (reason: string): Phon => ({ toks: [], syl: 0, skel: "", initC: 0, finalC: 0, medMax: 0, nuclei: [], reason });
  if (/(.)\1\1/.test(w)) return bad("triple");
  if (/th|ph|q/.test(w)) return bad("th-ph-q");
  if (w[0] === w[1]) return bad("initial-double");
  const s = shapeEn(w);
  if (!s.nuclei.length) return bad("no-vowel");
  const runLen = (r: string) => (r ? r.split("+").length : 0);
  if ([s.onset, s.coda, ...s.medial].some((r) => runLen(r) > 2)) return bad("ccc");
  if (s.nuclei.some((n) => n.length > 2)) return bad("vowel-run");
  if (!s.nuclei.every((n) => enLegal(enNuc, n))) return bad("vowel-pair");
  if (!enLegal(enOnset, s.onset)) return bad("initial-cluster");
  if (!enLegal(enCoda, s.coda)) return bad("final-cluster");
  if (!s.medial.every((m) => enLegal(enMed, m))) return bad("medial-cluster");
  if (engLogp(w) < EN_FLOOR) return bad("not-english-like");
  const toks = s.units.map((u) => ({ s: u.s, v: u.v }));
  return { toks, syl: s.nuclei.length, skel: s.units.map((u) => (u.v ? "V" : "C")).join(""), initC: runLen(s.onset),
    finalC: runLen(s.coda), medMax: Math.max(0, ...s.medial.map(runLen)), nuclei: s.nuclei };
}
// Spellings an English reader and a Persian reader may say differently.
function ambiguity(w: string): string {
  const f: string[] = [];
  if (/c[eiy]/.test(w)) f.push("soft-c");
  if (/ea|ou|ie|ei|ue|eu|au|oe|ow|ew/.test(w)) f.push("ambig-vowel");
  if (/[aeiou][^aeiou]e$/.test(w)) f.push("silent-e");
  return f.join("|");
}
type Gate = { p: Phon; tier: string; reason?: string; faReason?: string; loanReason?: string; enReason?: string };
function gate(w: string): Gate {
  if (!OPEN) {
    const p = analyze(w);
    const reason = p.reason ?? (blocked(w) ? "blocklist" : undefined);
    return { p, tier: analyze(w, false).reason ? "loan" : "native", reason };
  }
  // Three ways in: native Persian rules, the loan rules (Snapp/Tapsi-style spellings,
  // see TIER=loan above), or English rules. tier lists every one the name passes.
  if (blocked(w)) return { p: analyze(w, false), tier: "", reason: "blocklist", faReason: "blocklist", loanReason: "blocklist", enReason: "blocklist" };
  const pf = analyze(w, false), pl = analyze(w, true), pe = analyzeEng(w);
  const tiers = [!pf.reason && "persian", !pl.reason && "loan", !pe.reason && "english"].filter(Boolean).join("+");
  if (tiers) return { p: !pf.reason ? pf : !pl.reason ? pl : pe, tier: tiers };
  return { p: pf, tier: "", reason: `${pf.reason}/${pl.reason}/${pe.reason}`, faReason: pf.reason, loanReason: pl.reason, enReason: pe.reason };
}

// ---------------------------------------------------------------- scoring
// International readability: 1 minus penalties for things a non-Persian reader
// mispronounces or finds foreign-looking.
function intlScore(w: string, p: Phon): { intl: number; flags: string } {
  let pen = 0; const f: string[] = [];
  const hard = p.toks.filter((t) => t.s === "kh" || t.s === "gh" || t.s === "zh").length;
  if (hard) { pen += 0.35 * hard; f.push("hard"); }
  if (w.endsWith("e")) { pen += 0.3; f.push("final-e"); }
  if (p.nuclei.includes("ou")) { pen += 0.25; f.push("ou"); }
  if (p.nuclei.includes("ei")) { pen += 0.15; f.push("ei"); }
  if (p.nuclei.includes("aa")) { pen += 0.15; f.push("aa"); }
  if (p.nuclei.includes("ai")) { pen += 0.1; f.push("ai"); }
  if (p.finalC === 2) { pen += 0.15; f.push("final-cc"); }
  if (p.medMax >= 2) { pen += 0.05 * (p.medMax - 1); f.push("med-cc"); }
  if (/[^aeiou]h$/.test(w)) { pen += 0.2; f.push("final-ch"); }
  if (/j$/.test(w)) { pen += 0.1; f.push("final-j"); }
  return { intl: Math.max(0, 1 - pen), flags: f.join("|") };
}
const sylScore = (n: number) => (n === 2 ? 1 : n === 3 ? 0.75 : n === 1 ? 0.5 : 0.3);
const distinctScore = (w: string) => { const d = new Set(w).size; return d >= 5 ? 1 : d === 4 ? 0.8 : d === 3 ? 0.3 : 0; };

const W = { fing: 1.0, eng: 0.8, intl: 1.0, syl: 0.4, distinct: 0.4 };

// ---------------------------------------------------------------- pool
const db = new Database(dbPath, { readonly: true });
const rows = db.query("SELECT name, avail, price_usd FROM pool WHERE name_len = 5").values() as [string, string, number | null][];
db.close();
const tLoad = performance.now();

type Cand = {
  name: string; avail: string; price: number | null; sum: number; p: Phon; fing: number; fingN: number;
  eng: number; engN: number; intl: number; flags: string; score: number; rank: number; tier: string; ambig: string;
};
const pass: Cand[] = [];
const rejected = new Map<string, number>();
const rejectedRows: string[] = []; // every name that fails the gate, with the rule it broke
let poolN = 0;
for (const [full, avail, price] of rows) {
  const w = full.slice(0, 5);
  if (!/^[a-z]{5}$/.test(w)) continue;
  poolN++;
  const g = gate(w), p = g.p, reason = g.reason;
  if (reason) {
    bump(rejected, reason);
    rejectedRows.push(OPEN ? `${w},${g.faReason},${g.loanReason},${g.enReason},${avail},${price ?? ""}` : `${w},${reason},${avail},${price ?? ""}`);
    continue;
  }
  let sum = 0; for (let i = 0; i < 5; i++) sum += w.charCodeAt(i);
  const { intl, flags } = intlScore(w, p);
  pass.push({ name: w, avail, price, sum, p, fing: fingLogp(w), fingN: 0, eng: engLogp(w), engN: 0, intl, flags, score: 0, rank: 0, tier: g.tier, ambig: ambiguity(w) });
}

// Each LM score is normalised to 0..1 between the median of the passing pool
// (mostly letter soup, = 0) and the 75th percentile of real 5-letter words in that
// language (= 1). Above that it saturates, so very common vocabulary is not
// rewarded over equally plausible coinages.
const q = (xs: number[], f: number) => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))];
const fs = pass.map((c) => c.fing).sort((a, b) => a - b);
const es = pass.map((c) => c.eng).sort((a, b) => a - b);
const dict5 = [...dict.keys()].filter((w) => w.length === 5 && !analyze(w).reason).map(fingLogp).sort((a, b) => a - b);
const eng5 = english5.filter((w) => !analyze(w).reason).map(engLogp).sort((a, b) => a - b);
const fLo = q(fs, 0.5), fHi = q(dict5, 0.75), eLo = q(es, 0.5), eHi = q(eng5, 0.75);
const clip01 = (x: number) => Math.min(1, Math.max(0, x));
const normFing = (x: number) => clip01((x - fLo) / (fHi - fLo));
const normEng = (x: number) => clip01((x - eLo) / (eHi - eLo));

function total_(c: { fingN: number; engN: number; intl: number; p: Phon; name: string }) {
  return W.fing * c.fingN + W.eng * c.engN + W.intl * c.intl + W.syl * sylScore(c.p.syl) + W.distinct * distinctScore(c.name);
}
for (const c of pass) { c.fingN = normFing(c.fing); c.engN = normEng(c.eng); c.score = total_(c); }
// Ties (both LMs saturated) break on the raw, unclipped plausibility sum.
pass.sort((a, b) => b.score - a.score || (b.fing + b.eng) - (a.fing + a.eng) || a.name.localeCompare(b.name));
pass.forEach((c, i) => (c.rank = i + 1));
const tScore = performance.now();

// ---------------------------------------------------------------- outputs
const fmt = (x: number) => x.toFixed(3);
const english5Set = new Set(english5);
const head = "rank,tier,name,ambiguity,score,fing,eng,intl,syl,skel,distinct,flags,fa,en,src,sum,avail,price_usd\n";
const line = (c: Cand) =>
  [c.rank, c.tier, c.name, c.ambig, fmt(c.score), fmt(c.fing), fmt(c.eng), fmt(c.intl), c.p.syl, c.p.skel, new Set(c.name).size, c.flags,
    (dict.get(c.name) ?? "").replace(/[,"\s]/g, ""), english5Set.has(c.name) ? 1 : "", (ext.get(c.name) ?? "").replace(/,/g, "|"),
    c.sum, c.avail, c.price ?? ""].join(",");
await Bun.write(join(out, OPEN ? "pass.csv" : "all-pass.csv"), head + pass.map(line).join("\n") + "\n");
await Bun.write(join(out, "rejected.csv"), (OPEN ? "name,persian_reason,loan_reason,english_reason,avail,price_usd\n" : "name,reason,avail,price_usd\n") + rejectedRows.join("\n") + "\n");
await Bun.write(join(out, "top10k.csv"), head + pass.slice(0, 10000).map(line).join("\n") + "\n");
// top1k: walk the raw rank, keep at most CAP names per leading and per trailing trigram.
const CAP = 4, lead = new Map<string, number>(), trail = new Map<string, number>(), top1k: Cand[] = [];
for (const c of pass) {
  const a = c.name.slice(0, 3), b = c.name.slice(2);
  if ((lead.get(a) ?? 0) >= CAP || (trail.get(b) ?? 0) >= CAP) continue;
  bump(lead, a); bump(trail, b); top1k.push(c);
  if (top1k.length === 1000) break;
}
await Bun.write(join(out, "top1k.csv"), head + top1k.map(line).join("\n") + "\n");

// Loan mode: the soft score still favours native Persian spelling, so loan-tier names
// (the Snapp/Tapsi kind) sink in the mixed ranking. Rank them on their own too.
const loanOnly = LOAN ? pass.filter((c) => c.tier === "loan") : [];
if (LOAN) {
  await Bun.write(join(out, "loan-only-top10k.csv"), head + loanOnly.slice(0, 10000).map(line).join("\n") + "\n");
  const ll = new Map<string, number>(), lt = new Map<string, number>(), loan1k: Cand[] = [];
  for (const c of loanOnly) {
    const a = c.name.slice(0, 3), b = c.name.slice(2);
    if ((ll.get(a) ?? 0) >= CAP || (lt.get(b) ?? 0) >= CAP) continue;
    bump(ll, a); bump(lt, b); loan1k.push(c);
    if (loan1k.length === 1000) break;
  }
  await Bun.write(join(out, "loan-only-top1k.csv"), head + loan1k.map(line).join("\n") + "\n");
  // Where the brands that needed the loan rules land among loan-tier names only.
  const loanScores = loanOnly.map((c) => c.score);
  const loanPct = (s: number) => { let lo = 0, hi = loanScores.length; while (lo < hi) { const m = (lo + hi) >> 1; if (loanScores[m] > s) lo = m + 1; else hi = m; } return Math.round((1 - lo / loanScores.length) * 1000) / 10; };
  const needLoan = iranBrands.map((b) => b.name).filter((w) => w.length === 5 && analyze(w, false).reason && !analyze(w).reason);
  console.log(`loan-tier names: ${loanOnly.length.toLocaleString()}; brands that needed loan rules, percentile among them: ` +
    needLoan.map((w) => `${w}:${loanPct(scoreWord(w)!)}`).join(" "));
  console.log("loan-only top 60:", loan1k.slice(0, 60).map((c) => c.name).join(" "));
}

// ---------------------------------------------------------------- validation
const scores = pass.map((c) => c.score); // descending
function pctile(score: number): number { // share of passing pool scoring below this (0..100, higher is better)
  let lo = 0, hi = scores.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (scores[m] > score) lo = m + 1; else hi = m; }
  return Math.round((1 - lo / scores.length) * 1000) / 10;
}
function scoreWord(w: string): number | null {
  const { p, reason } = gate(w);
  if (reason) return null;
  const { intl } = intlScore(w, p);
  return total_({ fingN: normFing(fingLogp(w)), engN: normEng(engLogp(w)), intl, p, name: w });
}
type Group = { label: string; words: string[] };
function evalGroup(g: Group) {
  const words = uniq(g.words.map((name) => ({ name }))).map((x) => x.name);
  const reasons = new Map<string, number>();
  let passed = 0;
  const pcts: number[] = [], failed: string[] = [];
  for (const w of words) {
    const r = gate(w).reason;
    if (r) { bump(reasons, r); if (words.length <= 500) failed.push(`${w}:${r}`); continue; }
    passed++;
    if (w.length === 5) { const s = scoreWord(w); if (s !== null) pcts.push(pctile(s)); }
  }
  pcts.sort((a, b) => a - b);
  const med = pcts.length ? pcts[Math.floor(pcts.length / 2)] : null;
  const top10 = pcts.length ? Math.round((pcts.filter((x) => x >= 90).length / pcts.length) * 100) : null;
  const top25 = pcts.length ? Math.round((pcts.filter((x) => x >= 75).length / pcts.length) * 100) : null;
  return { label: g.label, n: words.length, pass: passed, passPct: Math.round((passed / words.length) * 1000) / 10,
    n5scored: pcts.length, medianPctile: med, inTop10pct: top10, inTop25pct: top25,
    rejectReasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])), failed };
}
// Finglish-only baseline percentile for the 5-letter Iranian brands, for comparison.
const fingSorted = pass.map((c) => c.fing).sort((a, b) => b - a);
function fingPctile(x: number) {
  let lo = 0, hi = fingSorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fingSorted[m] > x) lo = m + 1; else hi = m; }
  return Math.round((1 - lo / fingSorted.length) * 1000) / 10;
}
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const random5 = Array.from({ length: 50000 }, () => Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(rnd() * 26))).join(""));
const ext5 = [...ext.keys()].filter((w) => w.length === 5);
const groups = [
  evalGroup({ label: "iranian brands (all lengths)", words: iranBrands.map((b) => b.name) }),
  evalGroup({ label: "global brands (all lengths)", words: globBrands.map((b) => b.name) }),
  evalGroup({ label: "persian place/given names, 5L (finglish-ext)", words: ext5 }),
  evalGroup({ label: "english words, 5L", words: english5 }),
  evalGroup({ label: "random strings, 5L", words: random5 }),
];
const iran5 = iranBrands.map((b) => b.name).filter((w) => w.length === 5);
const iran5pass = iran5.filter((w) => scoreWord(w) !== null);
const brandTable = iran5.map((w) => ({ name: w, score: scoreWord(w), pctile: scoreWord(w) === null ? null : pctile(scoreWord(w)!), fingPctile: fingPctile(fingLogp(w)), reason: gate(w).reason ?? "" }));
const med = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const topStats = (xs: Cand[]) => ({
  n: xs.length,
  behnevisExact: Math.round((xs.filter((c) => dict.has(c.name)).length / xs.length) * 100),
  extWord: Math.round((xs.filter((c) => ext.has(c.name)).length / xs.length) * 100),
  englishWord: Math.round((xs.filter((c) => english5Set.has(c.name)).length / xs.length) * 100),
  hardConsonant: Math.round((xs.filter((c) => c.flags.includes("hard")).length / xs.length) * 100),
  syl: Object.fromEntries([1, 2, 3].map((n) => [n, xs.filter((c) => c.p.syl === n).length])),
  skel: Object.fromEntries([...new Map(xs.map((c) => [c.p.skel, xs.filter((d) => d.p.skel === c.p.skel).length]))].sort((a, b) => b[1] - a[1]).slice(0, 8)),
  availFree: Math.round((xs.filter((c) => c.avail === "free").length / xs.length) * 100),
  sumMedian: med(xs.map((c) => c.sum)),
  tiers: Object.fromEntries([...new Set(xs.map((c) => c.tier))].map((t) => [t, xs.filter((c) => c.tier === t).length])),
  ambiguous: Math.round((xs.filter((c) => c.ambig).length / xs.length) * 100),
  sumIn550to555: Math.round((xs.filter((c) => c.sum >= 550 && c.sum <= 555).length / xs.length) * 100),
});
const validation = {
  pool5: poolN, passed: pass.length, passPct: Math.round((pass.length / poolN) * 1000) / 10,
  rejectReasons: Object.fromEntries([...rejected].sort((a, b) => b[1] - a[1])),
  legalClusters: { finalCC: [...finalCC].filter(([, n]) => n >= MIN_KEYS).length, medialCC: [...medialCC].filter(([, n]) => n >= MIN_KEYS).length, medialCCC: [...medialCCC].filter(([, n]) => n >= MIN_KEYS).length, minKeys: MIN_KEYS },
  weights: W,
  normalisation: { fingLo: fLo, fingHi: fHi, engLo: eLo, engHi: eHi },
  groups,
  iranian5: { n: iran5.length, passed: iran5pass.length, medianPctile: med(brandTable.filter((b) => b.pctile !== null).map((b) => b.pctile!)),
    medianFinglishOnlyPctile: med(brandTable.filter((b) => b.pctile !== null).map((b) => b.fingPctile)), table: brandTable },
  top1k: topStats(top1k), top10k: topStats(pass.slice(0, 10000)),
  timingMs: { load: Math.round(tLoad - t0), score: Math.round(tScore - tLoad), total: Math.round(performance.now() - t0) },
};
await Bun.write(join(out, "validation.json"), JSON.stringify(validation, null, 2));

console.log(`pool 5L ${poolN.toLocaleString()} -> pass ${pass.length.toLocaleString()} (${validation.passPct}%)`);
console.log("rejects", validation.rejectReasons);
for (const g of groups) console.log(`${g.label}: n=${g.n} pass=${g.passPct}% median pctile=${g.medianPctile} top10%=${g.inTop10pct}% top25%=${g.inTop25pct}%`, g.rejectReasons);
console.log(`iranian 5L brands: ${iran5pass.length}/${iran5.length} pass, median pctile ${validation.iranian5.medianPctile} (finglish-only ${validation.iranian5.medianFinglishOnlyPctile})`);
console.log(brandTable.map((b) => `${b.name}:${b.pctile ?? b.reason}`).join(" "));
console.log("top1k", validation.top1k);
console.log("top 60:", top1k.slice(0, 60).map((c) => c.name).join(" "));
console.log(`timing load ${validation.timingMs.load} ms, score ${validation.timingMs.score} ms, total ${validation.timingMs.total} ms`);
