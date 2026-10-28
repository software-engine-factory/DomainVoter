# Background writer research

Prototype only. Application source is unchanged. Findings and proposed contract: `docs/research/2026-10-28-performance-worker.md`.

## Setup and safety

Use this study worktree with dependencies installed, Node 24, and the local canonical SQLite replica supplied by the study owner. Run from the worktree root. Never use a production database, application DATA_DIR, or a source with active writers. `PERF_SOURCE` is read as a file copy only; measured code writes exclusively to the worktree's gitignored `data/perf-worker/voting.db`. No source path or domain/user values are saved in results.

```powershell
$env:PERF_SOURCE='<absolute path to canonical local replica>'
$env:PERF_STANDARD='1'
$env:PERF_BUSY_MS='0'
$env:PERF_BRIEF='1'
```

Each measure invocation fresh-copies the replica if `PERF_SOURCE` is set. Copy, module loading, and reader priming occur outside timing. `DV_FREE_MOVE=off` and two read workers are set by the runner. The measure command without `PERF_SOURCE` reuses its existing scratch database, which is suitable only for reproducing the preliminary pilot, not matched comparisons.

## Commands

Coordinate an exclusive benchmark slot before full-size runs. The recorded rough comparison used one successful full-size pair after preliminary warmup work, three four-letter pairs after control warmup, and one compatibility sample. It deliberately does not run three full-size repeats.

```powershell
node tools/perf/worker/contention.mjs
node tools/perf/worker/recovery.mjs
& tools/perf/worker/run-series.ps1
node tools/perf/worker/summarize.mjs
```

`contention.mjs` and `recovery.mjs` create small independent synthetic databases. They assert a real BUSY_SNAPSHOT retry, exact conservation after worker termination/restart, admission rejection, hidden partial rounds, cancellation cleanup, and explicit retry after an injected error. They do not prove power-loss recovery or production supervision.

Individual full-size samples:

```powershell
node tools/perf/worker/measure.mjs baseline-batch 5 800000 r1
node tools/perf/worker/measure.mjs worker 5 800000 r1
$env:PERF_BUSY_MS='5000'
node tools/perf/worker/measure.mjs worker 5 800000 compatibility
$env:PERF_BUSY_MS='0'
node tools/perf/worker/measure.mjs baseline-batch 4 800000 r1
node tools/perf/worker/measure.mjs worker 4 800000 r1
```

These commands overwrite identically named raw result files. Use another run label for a new sample. The standardized selection is seeded random, length 5, any availability, cap 800000, exclude used, 80 rounds of 10000, create all. The four-letter controls use length 4 and stop at 120084 eligible names. Result JSON contains full arguments, timestamps, elapsed time, CPU, RSS, HTTP ping/vote latency, complete drain counts, errors, progress, conservation, and order digests.

The final four-letter control cap is 800000, not the preliminary pilot's 10000. `summary.json` derives its full-size comparison from `result-baseline-batch-5-800000-r1.json` and `result-worker-5-800000-r1.json`; its controls use the corresponding length-4 r1/r2/r3 files. Compatibility comes from `result-worker-5-800000-compatibility.json`. Each generated summary row lists its source files.

The source fingerprint and machine metadata are in the report and `machine.json`. Preliminary pilot files predate the final drain/retry protocol and are explicitly separate. `result-worker-warmup-busy-snapshot-failure.json` records a real excluded failure. `capture-failure.mjs` is the one-off readonly extractor for that original error checkpoint; it refuses other job states.

## UI adapter

`ui-adapter.mjs` exports `submit`, `status`, `cancel`, and `result` for the optional frontend study server. It always uses a fixed synthetic four-letter 10000-name pool under `data/perf-worker/ui`. It accepts no arbitrary source paths or workload parameters. The adapter exercises the actual SQLite worker, rather than a progress timer. The frontend integration result is in `tools/perf/frontend/results/integrated.json` after consolidation.

## Limits

Only the name/random batch shape exercised here is prototyped. Authentication, Next.js routes, existing action integration, owner leases, source manifests, automatic process recovery, arbitrary remainder modes/assignees, and deployment supervision are proposed specification work. Both tested main-connection timeout policies passed local latency gates. The data does not justify requiring a global timeout change.

Keep raw JSON. After all benchmark handles close, the known full scratch replica and its WAL/SHM files may be removed. Preserve the independent small UI/recovery fixtures if another study step still uses them. Never run recursive cleanup or derive a deletion path from `PERF_SOURCE`.
