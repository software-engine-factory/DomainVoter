# SQL and deferred materialization experiment

Research code only. It imports the real batch, reader and assignment modules. It writes only a restored full replica at `data/perf-sql/voting.db`. Never point `--source` at a running database or production storage.

Run from this worktree after installing dependencies. One process restores and measures one case so the production reader never keeps a stale handle across Windows file replacement.

```powershell
node tools/perf/sql/bench.mjs --source='<offline-replica>' --length=5 --order=random --variant=baseline-all --out=tools/perf/sql/results/sample.json
```

Variants:

| Variant | Selection | Immediate rounds |
| --- | --- | --- |
| `baseline-all` | Actual `createBatch`, window numbering and ordered aggregation | All |
| `baseline-first` | Actual `createBatch` | First |
| `sql-all` | Direct ordered cursor through existing reader | All |
| `sql-first` | Direct ordered cursor through existing reader | First |

Defaults are all availability, length 5, no set filter, exclude names already in domains, cap 800000, random FNV seed `perf-2026-10-28`, 80 planned rounds with 10000 names each, extra remainder rounds. Other knobs are `--length=4`, `--order=name`, `--perRound=800000`, `--cap=2000`, and `--exclude=false`.

`--materialize=chunked` builds closed staging rounds with small domain transactions, then copies assignments and publishes the completed round. `--transport=spool` replaces the unbounded reader queue with a separate read-only worker that writes a scratch JSONL file and closes its SQLite snapshot before replay starts. `--chunk=250` caps replay transactions at 250 rows. The spool worker retains at most 2000 serialized rows, replay reads at most 64 KiB plus one chunk, and IPC returns only counts. Disk space for the complete spool is still required. Spool files stay inside ignored scratch storage and are removed after replay.

`--http=true` adds a loopback server on the main thread and a separate client worker. It requests a database `SELECT 1` every 25ms and a vote-shaped insert/count/delete every 100ms, stops after the operation and drains every in-flight request before closing the server. A separate scratch row UPDATE runs every 25ms on the main connection, matching the durable worker study. Outputs contain only aggregate latencies, status/error counts and a check that total votes are preserved. This is a data seam with real SQLite activity, without Next routing, authentication or browser rendering.

`node tools/perf/sql/summarize.mjs` summarizes safe result JSONs. Add `--require-responsive` to make captured latency failures exit 1. `node tools/perf/sql/probe.mjs --source='<offline-replica>'` restores scratch again, times capped counts and name-order access paths three times, then builds a disposable name-length/name index. Run probes only when no benchmark process is using the copy.

`--gate=true` exits 1 if the 10ms timer has p95 gaps at least 250ms or a maximum at least 1000ms. With HTTP enabled, both HTTP operations must also meet those limits. A timer is a main event loop proxy, not a measured HTTP service latency. Correctness assertions always fail the process when violated. They check continuous positions, total and materialized counts, plus name, price, currency and pool linkage. Membership SHA256 compares full ordered snapshots across variants. This is behavior characterization for the proposed refactor, not a new product oracle.

The prototype retains the existing frozen names table and reads prices from `pool` when a round opens. Free names retain the current null voter price. Queue transport uses the existing unbounded reader queue. Spool transport bounds the transfer buffer by moving the full result to disk first. A production implementation still needs disk admission, batch staging status, crash recovery, cleanup on failure and concurrent build limits. This study is not a shipping implementation.
