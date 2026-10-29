import fs from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname, "results");
const files = fs.readdirSync(dir).filter((x) => /^(4l|5l)-.*\.json$/.test(x));
const rows = files.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
for (const [key, samples] of Map.groupBy(rows, (r) => `${r.input.length}-${r.input.order}-${r.input.cap}-${r.input.excludeUsed}`)) {
  if (new Set(samples.map((r) => r.membershipSha256)).size !== 1) throw new Error("Ordered membership differs: " + key);
  const expected = new Set(samples.map((r) => r.expectedSnapshotRows).filter((n) => n != null));
  if (expected.size !== 1 || samples.some((r) => !expected.has(r.snapshotRows))) throw new Error("Independent snapshot count differs: " + key);
}
const group = (row) => `${row.input.length}L-${row.variant}-${row.input.order}-${row.input.perRound}-${row.input.materialize || "synchronous"}-${row.input.transport || "queue"}`;
const groups = Map.groupBy(rows, group);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const summary = [...groups].map(([key, samples]) => ({
  key, n: samples.length,
  wallMeanMs: mean(samples.map((r) => r.wallMs)),
  cpuMeanMs: mean(samples.map((r) => r.cpuMs.user + r.cpuMs.system)),
  wallMinMs: Math.min(...samples.map((r) => r.wallMs)), wallMaxMs: Math.max(...samples.map((r) => r.wallMs)),
  timerGapP95WorstMs: Math.max(...samples.map((r) => r.timerGapMs.p95)),
  timerGapMaxMs: Math.max(...samples.map((r) => r.timerGapMs.max)),
  peakRssMaxBytes: Math.max(...samples.map((r) => r.peakRssBytes)),
  highWaterRssMaxBytes: Math.max(...samples.map((r) => r.processHighWaterRssBytes || 0)) || null,
  httpPingP95WorstMs: Math.max(...samples.map((r) => r.http?.ping.p95Ms || 0)) || null,
  httpPingMaxMs: Math.max(...samples.map((r) => r.http?.ping.maxMs || 0)) || null,
  httpVoteP95WorstMs: Math.max(...samples.map((r) => r.http?.voteShapedWrite.p95Ms || 0)) || null,
  httpVoteMaxMs: Math.max(...samples.map((r) => r.http?.voteShapedWrite.maxMs || 0)) || null,
  membershipHashCount: new Set(samples.map((r) => r.membershipSha256)).size,
  snapshotRows: samples[0].snapshotRows, materializedRows: samples[0].materializedRows,
  allRecordedChecksPass: samples.every((r) => Object.entries(r.assertions).every(([k, v]) => k === "priceNameCurrencyMismatches" ? v === 0 : v === true) && (!r.http || (r.http.errors.length === 0 && r.http.writeFailures === 0 && r.http.writerErrors.length === 0 && r.http.voteCountPreserved && r.http.drain.startedCount === r.http.drain.completedCount))),
}));
console.log(JSON.stringify(summary, null, 2));
// Gate checks captured measurements from the actual production seam. It is
// intentionally red for an observed >=1s baseline main-thread gap.
if (process.argv.includes("--require-responsive")) {
  const failures = rows.filter((r) => r.timerGapMs.p95 >= 250 || r.timerGapMs.max >= 1000 || (r.http && (r.http.ping.p95Ms >= 250 || r.http.ping.maxMs >= 1000 || r.http.voteShapedWrite.p95Ms >= 250 || r.http.voteShapedWrite.maxMs >= 1000)));
  if (failures.length) {
    console.error("Responsiveness failed: " + failures.map((r) => `${r.file} timerMax=${r.timerGapMs.max.toFixed(1)}ms${r.http ? ` HTTPpingP95=${r.http.ping.p95Ms.toFixed(1)}ms/max=${r.http.ping.maxMs.toFixed(1)}ms` : ""}`).join(", "));
    process.exitCode = 1;
  }
}
