// Rank the pool by how much each name looks like a successful Iranian brand.
// This measures name shape, not business odds: it learns from 3-6 letter Iranian
// brands in brands.csv (startups weighted 3x) and scores every pool name on
//   1. Finglish-ness   trigram model trained on the Behnevis dictionary
//   2. ASCII band      where Iranian brands sit on the scaled-sum axis vs the pool
//   3. CV shape        consonant/vowel pattern (e.g. CVCVC) vs the pool
//   4. first/last letter
//   5. distinct letters (penalises "babeb"-style repeats)
// Each of 2-4 is a log ratio P(feature | Iranian brand) / P(feature | pool).
// Usage: bun unicorn.ts [topN]
import { readFileSync } from "node:fs";

const TOP = Number(Bun.argv[2] ?? 10000);
const t0 = performance.now();

// Iranian startups and consumer-tech names: the closest thing to "unicorn-shaped".
const STARTUPS = new Set("snapp tapsi divar torob myket bazaar aparat filimo namava fidibo jabama jajiga okala wallex bitpin rubika eitaa bale balad neshan miare vandar blu hiweb shatel bamilo dotin esam".split(" "));

// ---- Finglish trigram model (same as finglish.ts) ----
const dict = new Set<string>();
for (const m of readFileSync("behnevis/combined_tables.js", "utf8").matchAll(/"([a-z]+)":"/g)) dict.add(m[1]);
const A = 27, id = (c: number) => c - 96;
const c1 = new Float64Array(A), c2 = new Float64Array(A * A), c3 = new Float64Array(A * A * A), x1 = new Float64Array(A), x2 = new Float64Array(A * A);
let tot = 0;
for (const w of dict) {
  let a = 0, b = 0;
  for (let i = 0; i <= w.length; i++) {
    const c = i < w.length ? id(w.charCodeAt(i)) : 0;
    c1[c]++; tot++; c2[b * A + c]++; x1[b]++; c3[(a * A + b) * A + c]++; x2[a * A + b]++; a = b; b = c;
  }
}
const lp = new Float64Array(A * A * A);
for (let a = 0; a < A; a++) for (let b = 0; b < A; b++) for (let c = 0; c < A; c++) {
  const p3 = x2[a * A + b] ? c3[(a * A + b) * A + c] / x2[a * A + b] : 0, p2 = x1[b] ? c2[b * A + c] / x1[b] : 0;
  lp[(a * A + b) * A + c] = Math.log2(0.6 * p3 + 0.3 * p2 + 0.1 * c1[c] / tot + 1e-9);
}
function finglish(w: string) {
  let a = 0, b = 0, s = 0;
  for (let i = 0; i <= w.length; i++) { const c = i < w.length ? id(w.charCodeAt(i)) : 0; s += lp[(a * A + b) * A + c]; a = b; b = c; }
  return s / (w.length + 1);
}

// ---- Features ----
const isV = (ch: string) => "aeiou".includes(ch);
const shape = (w: string) => [...w].map((ch) => (isV(ch) ? "V" : "C")).join("");
const sumOf = (w: string) => { let s = 0; for (let i = 0; i < w.length; i++) s += w.charCodeAt(i); return s; };
const scaled = (w: string) => Math.round((sumOf(w) * 5) / w.length);
// Hard rules: Persian has no tripled letters, no x/w, c only in "ch", and no
// initial consonant cluster except the digraphs.
function allowed(w: string) {
  if (/(.)\1\1/.test(w) || /[xw]/.test(w) || /c(?!h)/.test(w)) return false;
  if (/^[^aeiou][^aeiouy]/.test(w.replace(/^(sh|kh|ch|gh|zh)/, "X"))) return false;
  return /[aeiou]/.test(w);
}

// ---- Pool ----
type Row = { w: string; len: number; sum: number; s5: number; fl: number; score: number };
const pool: Row[] = [];
for (const line of readFileSync("finglish-all.csv", "utf8").split("\n").slice(1)) {
  if (!line) continue;
  const [w, len, sum, , logp] = line.split(",");
  pool.push({ w, len: +len, sum: +sum, s5: Math.round((+sum * 5) / +len), fl: +logp, score: 0 });
}
const tRead = performance.now();

// Pool distributions (the denominators).
const count = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const distinct = (w: string) => w.length + ":" + new Set(w).size;
const poolDistinct = new Map<string, number>();
const poolS5 = new Map<number, number>(), poolShape = new Map<string, number>(), poolFirst = new Map<string, number>(), poolLast = new Map<string, number>();
let flMean = 0;
for (const r of pool) {
  count(poolS5, r.s5); count(poolShape, shape(r.w)); count(poolFirst, r.len + r.w[0]); count(poolLast, r.len + r.w[r.len - 1]); count(poolDistinct, distinct(r.w));
  flMean += r.fl;
}
flMean /= pool.length;
let flSd = 0;
for (const r of pool) flSd += (r.fl - flMean) ** 2;
flSd = Math.sqrt(flSd / pool.length);
const lenCount = new Map<number, number>();
for (const r of pool) count(lenCount, r.len);

// Reference set: Iranian brands that fit the pool's lengths (3-5).
const iranAll = readFileSync("brands.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","))
  .filter((b) => b[5] === "1" && +b[2] >= 3 && +b[2] <= 5).map((b) => b[3]);

function fit(ref: string[]) {
  const wOf = (w: string) => (STARTUPS.has(w) ? 3 : 1);
  const di = new Map<string, number>();
  const s5 = new Map<number, number>(), sh = new Map<string, number>(), fi = new Map<string, number>(), la = new Map<string, number>(), ln = new Map<number, number>();
  let W = 0;
  for (const w of ref) {
    const k = wOf(w); W += k;
    count(s5, scaled(w), k); count(sh, shape(w), k); count(fi, w.length + w[0], k); count(la, w.length + w[w.length - 1], k); count(ln, w.length, k); count(di, distinct(w), k);
  }
  // Gaussian-smoothed band density (bandwidth 6) for brands, light smoothing for the pool.
  const kde = (m: Map<number, number>, bw: number, total: number) => (s: number) => {
    let d = 0;
    for (const [x, c] of m) d += c * Math.exp(-((s - x) ** 2) / (2 * bw * bw));
    return d / (total * bw * Math.sqrt(2 * Math.PI));
  };
  const bandIran = kde(s5, 6, W), bandPool = kde(poolS5, 2, pool.length);
  const bandCache = new Map<number, number>();
  const clip = (x: number) => Math.max(-3, Math.min(3, x));
  // The pool is thin in the tails, so a raw band ratio would reward extreme sums; cap the upside.
  const clipBand = (x: number) => Math.max(-3, Math.min(1, x));
  // log P(feature | brand) - log P(feature | pool). The brand estimate is shrunk toward
  // the pool (prior weight M), so a category no brand has scores below 0, never above:
  // add-constant smoothing made rare pool shapes like "mamam" look brand-like.
  const M = 5;
  const ratio = <K>(ref: Map<K, number>, refTot: number, poolM: Map<K, number>, poolTot: number, _cats: number, k: K) => {
    const pPool = (poolM.get(k) ?? 0.5) / poolTot;
    return clip(Math.log(((ref.get(k) ?? 0) + M * pPool) / (refTot + M)) - Math.log(pPool));
  };
  return (w: string, fl: number) => {
    const s = scaled(w), L = w.length;
    if (!bandCache.has(s)) bandCache.set(s, clipBand(Math.log((bandIran(s) + 1e-6) / (bandPool(s) + 1e-6))));
    const refL = ln.get(L) ?? 0, poolL = lenCount.get(L) ?? 1;
    return (
      (fl - flMean) / flSd +
      bandCache.get(s)! +
      ratio(sh, refL, poolShape, poolL, 2 ** L, shape(w)) +
      ratio(fi, refL, poolFirst, poolL, 26, L + w[0]) +
      ratio(la, refL, poolLast, poolL, 26, L + w[L - 1]) +
      ratio(di, refL, poolDistinct, poolL, L, distinct(w))
    );
  };
}

// ---- Validation: fit on half the Iranian brands, test on the other half ----
// AUC = chance a held-out Iranian brand outscores a random pool name (0.5 = coin flip).
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const sample = Array.from({ length: 20000 }, () => pool[Math.floor(rnd() * pool.length)]);
const globalRef = readFileSync("brands.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","))
  .filter((b) => b[5] === "0" && +b[2] >= 3 && +b[2] <= 5).map((b) => b[3]);
const auc = (f: (w: string, fl: number) => number, test: string[]) => {
  const r = sample.map((p) => f(p.w, p.fl)).sort((a, b) => a - b);
  let s = 0;
  for (const w of test) { const v = f(w, finglish(w)); let lo = 0, hi = r.length; while (lo < hi) { const m = (lo + hi) >> 1; r[m] < v ? (lo = m + 1) : (hi = m); } s += lo / r.length; }
  return s / test.length;
};
const aucs: number[] = [], aucsG: number[] = [], aucsNew: number[] = [], aucsNewF: number[] = [];
for (let k = 0; k < 10; k++) {
  const sh = [...iranAll].sort(() => rnd() - 0.5);
  const train = sh.slice(0, sh.length >> 1), test = sh.slice(sh.length >> 1);
  const f = fit(train);
  aucs.push(auc(f, test)); aucsG.push(auc(f, globalRef));
  // Fair comparison: held-out brands the Finglish model never saw (not Behnevis words).
  const unseen = test.filter((w) => !dict.has(w));
  aucsNew.push(auc(f, unseen)); aucsNewF.push(auc((_w, fl) => fl, unseen));
}
// Baseline: Finglish model alone, no fitting on brands.
const aucFinglish = auc((_w, fl) => fl, iranAll), aucFinglishG = auc((_w, fl) => fl, globalRef);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- Final: fit on all Iranian brands, score and filter the pool ----
const f = fit(iranAll);
const kept = pool.filter((r) => allowed(r.w));
for (const r of kept) r.score = f(r.w, r.fl);
// Rank by Finglish score. The brand-shape score did not beat it on held-out brands
// the Finglish model never saw (see "not in Behnevis" line), so it is kept as a column only.
kept.sort((a, b) => b.fl - a.fl || b.score - a.score);
const top = kept.slice(0, TOP);
const tScore = performance.now();

// Same ranking, restricted to the 5-letter 550-555 band picked earlier.
const locked = kept.filter((r) => r.len === 5 && r.sum >= 550 && r.sum <= 555);
await Bun.write("unicorn-550-555.csv", "rank,name,sum,finglish_logp,brand_shape\n" +
  locked.map((r, i) => `${i + 1},${r.w},${r.sum},${r.fl},${r.score.toFixed(3)}`).join("\n") + "\n");
await Bun.write("unicorn-top.csv", "rank,name,len,sum,scaled,finglish_logp,brand_shape\n" +
  top.map((r, i) => `${i + 1},${r.w},${r.len},${r.sum},${r.s5},${r.fl},${r.score.toFixed(3)}`).join("\n") + "\n");

// Chart: where the top names sit on the 5-letter curve, with the Iranian brands for reference.
const hist = readFileSync("ascii-sum.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(",").map(Number));
const topHist = new Map<number, number>();
for (const r of top) count(topHist, r.s5);
const iranS5 = iranAll.map(scaled);
const minS = 480, maxS = 615, W = 1400, P = 60, H = 460;
const bw = (W - 2 * P) / (maxS - minS + 1), x = (s: number) => P + (s - minS) * bw;
const maxPool = Math.max(...hist.map((h) => h[1])), maxTop = Math.max(...topHist.values());
const svg = [
  ...hist.map(([s, c]) => `<rect x="${x(s)}" y="${380 - (c / maxPool) * 330}" width="${bw - 0.5}" height="${(c / maxPool) * 330}" fill="#c9d6ee"/>`),
  ...[...topHist].map(([s, c]) => `<rect x="${x(s) + bw * 0.2}" y="${380 - (c / maxTop) * 330}" width="${bw * 0.6}" height="${(c / maxTop) * 330}" fill="#d0452b"><title>sum ${s}: ${c} of top ${TOP}</title></rect>`),
  ...iranS5.map((s, i) => `<circle cx="${x(s) + bw / 2}" cy="${395 + (i % 4) * 9}" r="3.5" fill="#1a8f2c"><title>${iranAll[i]} ${s}</title></circle>`),
  ...Array.from({ length: 14 }, (_, i) => 480 + i * 10).map((s) => `<text x="${x(s) + bw / 2}" y="${H - 8}" text-anchor="middle">${s}</text>`),
];
const inIranBand = top.filter((r) => r.s5 >= 500 && r.s5 <= 556).length;
const inLocked = top.filter((r) => r.len === 5 && r.sum >= 550 && r.sum <= 555).length;
const html = `<!doctype html><meta charset="utf-8"><title>Iranian-brand candidates</title>
<style>body{font:14px system-ui,sans-serif;margin:24px}svg text{font-size:11px;fill:#444}.g{display:grid;grid-template-columns:repeat(10,1fr);gap:2px 16px;max-width:1300px}.g span{font-family:ui-monospace,monospace}</style>
<h2>Top ${TOP.toLocaleString()} most Finglish names (Iranian-brand candidates)</h2>
<p>Held-out test: a hidden Iranian brand outscores a random pool name <b>${(mean(aucs) * 100).toFixed(1)}%</b> of the time; a global brand ${(mean(aucsG) * 100).toFixed(1)}%. ${kept.length.toLocaleString()} of ${pool.length.toLocaleString()} names pass the hard rules.</p>
<p>Top ${TOP.toLocaleString()}: ${inIranBand.toLocaleString()} (${Math.round((inIranBand / TOP) * 100)}%) in the Iranian-brand range 500-556 · ${inLocked.toLocaleString()} in 550-555 (5L). Blue = 5-letter pool, red = top ${TOP.toLocaleString()} (scaled sum), green dots = Iranian brands.</p>
<svg width="${W}" height="${H}">${svg.join("")}</svg>
<h3>Top 500</h3><div class="g">${top.slice(0, 500).map((r) => `<span title="finglish ${r.fl} · brand shape ${r.score.toFixed(2)} · sum ${r.sum}">${r.w}</span>`).join("")}</div>`;
await Bun.write("unicorn.html", html);

console.log(`held-out AUC: Iranian ${(mean(aucs) * 100).toFixed(1)}% (min ${(Math.min(...aucs) * 100).toFixed(1)}), global brands ${(mean(aucsG) * 100).toFixed(1)}%`);
console.log(`held-out, not in Behnevis: combined ${(mean(aucsNew) * 100).toFixed(1)}% vs Finglish only ${(mean(aucsNewF) * 100).toFixed(1)}%`);
console.log(`baseline Finglish only: Iranian ${(aucFinglish * 100).toFixed(1)}%, global ${(aucFinglishG * 100).toFixed(1)}%`);
console.log(`550-555 band after rules: ${locked.length.toLocaleString()}; top 40: ${locked.slice(0, 40).map((r) => r.w).join(" ")}`);
console.log(`pass hard rules: ${kept.length.toLocaleString()} / ${pool.length.toLocaleString()}`);
console.log(`top ${TOP}: ${inIranBand} in 500-556, ${inLocked} in 550-555 (5L); by length ${[3, 4, 5].map((l) => l + "L " + top.filter((r) => r.len === l).length).join(", ")}`);
console.log(`top 60: ${top.slice(0, 60).map((r) => r.w).join(" ")}`);
console.log(`read ${(tRead - t0).toFixed(0)} ms, total ${(tScore - t0).toFixed(0)} ms`);
