// Sum the ASCII codes of every 5-letter domain label (the part before ".com")
// and chart how many domains land on each sum. Usage: bun ascii-sum.ts [db] [out.html]
import { Database } from "bun:sqlite";

const dbPath = Bun.argv[2] ?? "voting-copy.db";
const outPath = Bun.argv[3] ?? "ascii-sum.html";
const t0 = performance.now();

const db = new Database(dbPath, { readonly: true });
const rows = db.query("SELECT name FROM pool").values() as [string][];
db.close();
const tRead = performance.now();

const counts = new Map<number, number>();
let total = 0;
for (const [name] of rows) {
  const dot = name.indexOf(".");
  const len = dot === -1 ? name.length : dot;
  if (len !== 5) continue;
  let s = 0;
  for (let i = 0; i < 5; i++) s += name.charCodeAt(i);
  counts.set(s, (counts.get(s) ?? 0) + 1);
  total++;
}
const tSum = performance.now();

// Sorted by sum ascending, so the counts form the bell shape on the x axis.
const bins = [...counts.entries()].sort((a, b) => a[0] - b[0]);
let mean = 0;
for (const [s, c] of bins) mean += s * c;
mean /= total;
let v = 0;
for (const [s, c] of bins) v += c * (s - mean) ** 2;
const sd = Math.sqrt(v / total);
const peak = bins.reduce((a, b) => (b[1] > a[1] ? b : a));

// Self-contained SVG bar chart with a fitted normal curve overlay.
const W = 1400, H = 600, P = 60;
const minS = bins[0][0], maxS = bins[bins.length - 1][0];
const maxC = peak[1];
const x = (s: number) => P + ((s - minS) / (maxS - minS + 1)) * (W - 2 * P);
const y = (c: number) => H - P - (c / maxC) * (H - 2 * P);
const bw = (W - 2 * P) / (maxS - minS + 1);
const bars = bins
  .map(([s, c]) => `<rect x="${x(s).toFixed(2)}" y="${y(c).toFixed(2)}" width="${Math.max(bw - 0.5, 0.5).toFixed(2)}" height="${(H - P - y(c)).toFixed(2)}" fill="#4a7bd0"><title>sum ${s}: ${c.toLocaleString()}</title></rect>`)
  .join("");
const curve = [];
for (let s = minS; s <= maxS; s += 0.5) {
  const c = (total / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((s - mean) ** 2) / (2 * sd * sd));
  curve.push(`${(x(s) + bw / 2).toFixed(1)},${y(c).toFixed(1)}`);
}
const ticks = [];
for (let s = Math.ceil(minS / 10) * 10; s <= maxS; s += 10)
  ticks.push(`<text x="${(x(s) + bw / 2).toFixed(1)}" y="${H - P + 18}" text-anchor="middle">${s}</text>`);
const yt = [];
for (let i = 0; i <= 5; i++) {
  const c = (maxC * i) / 5;
  yt.push(`<text x="${P - 6}" y="${y(c) + 4}" text-anchor="end">${Math.round(c).toLocaleString()}</text><line x1="${P}" x2="${W - P}" y1="${y(c)}" y2="${y(c)}" stroke="#eee"/>`);
}
const html = `<!doctype html><meta charset="utf-8"><title>ASCII sum of 5-letter domains</title>
<style>body{font:14px system-ui,sans-serif;margin:24px}svg text{font-size:11px;fill:#444}table{border-collapse:collapse;margin-top:16px}td,th{padding:2px 10px;border-bottom:1px solid #eee;text-align:right}</style>
<h2>ASCII sum of 5-letter domain labels</h2>
<p>${total.toLocaleString()} domains · sums ${minS}-${maxS} · mean ${mean.toFixed(2)} · sd ${sd.toFixed(2)} · peak ${peak[0]} (${peak[1].toLocaleString()} domains) · red line = normal fit</p>
<svg width="${W}" height="${H}">${yt.join("")}${bars}<polyline fill="none" stroke="#d04a4a" stroke-width="2" points="${curve.join(" ")}"/>${ticks.join("")}
<text x="${W / 2}" y="${H - 15}" text-anchor="middle">sum of ASCII codes</text></svg>
<table><tr><th>sum</th><th>domains</th></tr>${bins.map(([s, c]) => `<tr><td>${s}</td><td>${c.toLocaleString()}</td></tr>`).join("")}</table>`;
await Bun.write(outPath, html);
await Bun.write(outPath.replace(/\.html$/, ".csv"), "sum,count\n" + bins.map(([s, c]) => `${s},${c}`).join("\n") + "\n");

console.log(`rows read: ${rows.length.toLocaleString()}  5-letter: ${total.toLocaleString()}`);
console.log(`sum range ${minS}-${maxS}, mean ${mean.toFixed(2)}, sd ${sd.toFixed(2)}, peak ${peak[0]} (${peak[1]})`);
console.log(`read ${(tRead - t0).toFixed(0)} ms, sum ${(tSum - tRead).toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`);
console.log(`wrote ${outPath} and .csv`);
