// Turn the screening lists into the file the release applies to pool.set_6..set_8.
// Reads research/name-screening/out/open/{pass,rejected,forbidden}.csv and the optional
// hand-picked exceptions (research/name-screening/screen-exceptions.txt, one name per
// line, with or without ".com"); exceptions move a rejected name to prefiltered.
// Writes ops/release/screen-categories.tsv.gz (git-ignored, shipped like migrate.cjs):
//   <name>.com<TAB><set id>   6 prefiltered, 7 rejected, 8 banned
// Usage: bun scripts/screen/export-categories.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { OUT, RES, ROOT } from "./paths";

const SETS = { pass: 6, rejected: 7, forbidden: 8 } as const;
const names = (file: string, col: number) =>
  readFileSync(join(OUT, "open", file), "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[col]);

const cat = new Map<string, number>();
for (const n of names("pass.csv", 2)) cat.set(n, SETS.pass);
for (const n of names("rejected.csv", 0)) cat.set(n, SETS.rejected);
for (const n of names("forbidden.csv", 0)) cat.set(n, SETS.forbidden);

const exPath = join(RES, "screen-exceptions.txt");
let moved = 0;
const unknown: string[] = [];
if (existsSync(exPath))
  for (const raw of readFileSync(exPath, "utf8").split(/\r?\n/)) {
    const n = raw.trim().toLowerCase().replace(/\.com$/, "");
    if (!n || n.startsWith("#")) continue;
    if (cat.get(n) === SETS.rejected) { cat.set(n, SETS.pass); moved++; } else if (!cat.has(n)) unknown.push(n);
  }

const lines = [...cat].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, s]) => `${n}.com\t${s}`);
const gz = gzipSync(lines.join("\n") + "\n", { level: 9 });
await Bun.write(join(ROOT, "ops/release/screen-categories.tsv.gz"), gz);
const count = (s: number) => [...cat.values()].filter((v) => v === s).length;
console.log(`names ${cat.size} · prefiltered ${count(6)} · rejected ${count(7)} · banned ${count(8)} · exceptions moved ${moved}` +
  (unknown.length ? ` · exceptions not found ${unknown.length}: ${unknown.slice(0, 20).join(" ")}` : "") + ` · ${(gz.length / 1e6).toFixed(1)} MB`);
