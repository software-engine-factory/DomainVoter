// Finglishibility score for every name in the pool.
// Trains a character trigram model on Behnevis's 219K Finglish dictionary keys
// (real Finglish spellings) and scores each name by average log2-probability per
// character. Also flags exact dictionary hits.
// Usage: bun finglish.ts [db] [lo] [hi]   (lo/hi = ASCII-sum band to export separately)
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const dbPath = Bun.argv[2] ?? "voting-copy.db";
const lo = Number(Bun.argv[3] ?? 550);
const hi = Number(Bun.argv[4] ?? 555);
const t0 = performance.now();

// 1. Dictionary keys. The file is a JS object literal: knownWordsTable_map = {"salam":"سلام",...}
const src = readFileSync("behnevis/combined_tables.js", "utf8");
const dict = new Set<string>();
for (const m of src.matchAll(/"([a-z]+)":"/g)) dict.add(m[1]);

// 2. Trigram counts over a-z plus a boundary symbol (index 0), with two start pads.
const A = 27;
const id = (c: number) => c - 96; // 'a' -> 1
const c1 = new Float64Array(A), c2 = new Float64Array(A * A), c3 = new Float64Array(A * A * A);
const ctx1 = new Float64Array(A), ctx2 = new Float64Array(A * A);
let total = 0;
for (const w of dict) {
  let p2 = 0, p1 = 0;
  for (let i = 0; i <= w.length; i++) {
    const c = i < w.length ? id(w.charCodeAt(i)) : 0;
    c1[c]++; total++;
    c2[p1 * A + c]++; ctx1[p1]++;
    c3[(p2 * A + p1) * A + c]++; ctx2[p2 * A + p1]++;
    p2 = p1; p1 = c;
  }
}

// Interpolated trigram, precomputed as a log2 table so scoring is one lookup per char.
const L3 = 0.6, L2 = 0.3, L1 = 0.1;
const logp = new Float64Array(A * A * A);
for (let a = 0; a < A; a++)
  for (let b = 0; b < A; b++)
    for (let c = 0; c < A; c++) {
      const p3 = ctx2[a * A + b] ? c3[(a * A + b) * A + c] / ctx2[a * A + b] : 0;
      const pb = ctx1[b] ? c2[b * A + c] / ctx1[b] : 0;
      logp[(a * A + b) * A + c] = Math.log2(L3 * p3 + L2 * pb + L1 * (c1[c] / total) + 1e-9);
    }

function score(w: string): number {
  let p2 = 0, p1 = 0, s = 0;
  for (let i = 0; i <= w.length; i++) {
    const c = i < w.length ? id(w.charCodeAt(i)) : 0;
    s += logp[(p2 * A + p1) * A + c];
    p2 = p1; p1 = c;
  }
  s /= w.length + 1;
  // Persian phonotactics the trigram misses: no tripled letters ("pooon") and no
  // word-initial consonant cluster except the digraphs ("stesh" is "estesh" in Persian).
  if (/(.)\1\1/.test(w)) s -= 1;
  if (/^[^aeiou][^aeiouy]/.test(w.replace(/^(sh|kh|ch|gh|zh)/, "X"))) s -= 0.5;
  return s;
}
const tTrain = performance.now();

// 3. Score the pool.
const db = new Database(dbPath, { readonly: true });
const names = db.query("SELECT name FROM pool").values() as [string][];
db.close();

type Row = { label: string; len: number; sum: number; exact: boolean; s: number; pct: number };
const rows: Row[] = [];
for (const [name] of names) {
  const dot = name.indexOf(".");
  const label = dot === -1 ? name : name.slice(0, dot);
  if (!/^[a-z]+$/.test(label)) continue;
  let sum = 0;
  for (let i = 0; i < label.length; i++) sum += label.charCodeAt(i);
  rows.push({ label, len: label.length, sum, exact: dict.has(label), s: score(label), pct: 0 });
}
// Percentile within the same length, so 3-, 4- and 5-letter names are comparable.
for (const len of [3, 4, 5]) {
  const g = rows.filter((r) => r.len === len).sort((a, b) => a.s - b.s);
  g.forEach((r, i) => (r.pct = Math.round((i / Math.max(g.length - 1, 1)) * 1000) / 10));
}
rows.sort((a, b) => b.s - a.s);
const tScore = performance.now();

const line = (r: Row) => `${r.label},${r.len},${r.sum},${r.exact ? 1 : 0},${r.s.toFixed(3)},${r.pct}`;
const head = "name,len,sum,exact,logp,pct\n";
await Bun.write("finglish-all.csv", head + rows.map(line).join("\n") + "\n");
const band = rows.filter((r) => r.len === 5 && r.sum >= lo && r.sum <= hi);
await Bun.write(`finglish-${lo}-${hi}.csv`, head + band.map(line).join("\n") + "\n");

// 4. Sanity check: Iranian brands should score higher than global ones.
const brands = readFileSync("brands.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const iranS = brands.filter((b) => b[5] === "1").map((b) => score(b[3]));
const globS = brands.filter((b) => b[5] === "0").map((b) => score(b[3]));
const p5 = rows.filter((r) => r.len === 5).map((r) => r.s).sort((a, b) => a - b);
const pctOf = (s: number) => Math.round((p5.findIndex((x) => x >= s) / p5.length) * 100);

console.log(`dictionary keys ${dict.size.toLocaleString()} · pool scored ${rows.length.toLocaleString()} · exact hits ${rows.filter((r) => r.exact).length.toLocaleString()}`);
console.log(`band ${lo}-${hi}: ${band.length.toLocaleString()} names, ${band.filter((r) => r.exact).length} exact hits`);
console.log(`median logp  Iranian brands ${median(iranS).toFixed(3)} (5L pct ~${pctOf(median(iranS))}) · global brands ${median(globS).toFixed(3)} (pct ~${pctOf(median(globS))})`);
console.log(`top 40 in band: ${band.slice(0, 40).map((r) => r.label + (r.exact ? "*" : "")).join(" ")}`);
console.log(`bottom 10 in band: ${band.slice(-10).map((r) => r.label).join(" ")}`);
console.log(`train ${(tTrain - t0).toFixed(0)} ms · score+sort ${(tScore - tTrain).toFixed(0)} ms · total ${(performance.now() - t0).toFixed(0)} ms`);
