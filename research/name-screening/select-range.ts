// List the 5-letter domains whose ASCII sum falls in [min, max].
// Usage: bun select-range.ts <min> <max> [db] [out.csv]
import { Database } from "bun:sqlite";

const min = Number(Bun.argv[2] ?? 526);
const max = Number(Bun.argv[3] ?? 563);
const dbPath = Bun.argv[4] ?? "voting-copy.db";
const outPath = Bun.argv[5] ?? `names-${min}-${max}.csv`;
const t0 = performance.now();

const db = new Database(dbPath, { readonly: true });
const rows = db.query("SELECT name FROM pool").values() as [string][];
db.close();

const hits: [number, string][] = [];
for (const [name] of rows) {
  const dot = name.indexOf(".");
  if ((dot === -1 ? name.length : dot) !== 5) continue;
  let s = 0;
  for (let i = 0; i < 5; i++) s += name.charCodeAt(i);
  if (s >= min && s <= max) hits.push([s, name]);
}
hits.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

await Bun.write(outPath, "sum,name\n" + hits.map(([s, n]) => `${s},${n}`).join("\n") + "\n");
console.log(`${hits.length.toLocaleString()} names with sum ${min}-${max} -> ${outPath} (${(performance.now() - t0).toFixed(0)} ms)`);
