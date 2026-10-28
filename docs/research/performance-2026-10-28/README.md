# Local performance options

Recommendation: backend A, persisted worker jobs, with frontend F2, an accepted ticket and resumable monitor. This addresses request blocking and gives long work a visible lifecycle. Keep the tested current web lock policy initially; a vote-system rewrite is not justified by the compatibility results. Backend B is a smaller architecture change with lower measured memory and bounded staging, but its full-size sample missed the proposed latency target and took longer.

These are research prototypes and an implementation proposal. Application source, package files and deployment configuration are unchanged. Production databases and processes were not accessed. The study branch is `research/local-performance-2026-10-28`, based on application revision `0506c5e`, in the DomainVoter repository.

## What causes the stall

The database replica is 984,096,768 bytes and contains 2,468,782 pool rows, including 2,338,250 five-letter names. Its size is not a reason by itself to replace SQLite. The reproduced call path still opens a whole round through a synchronous `INSERT ... SELECT` on the web connection. An allowed single 800,000-name round produced an observed 4.35-second HTTP wait in the preliminary reproduction.

The latest application already has read workers, cached aggregates and some chunked writes. The remaining whole-round transaction, repeated selection sorts and count scheduling need attention. A first chunked streaming experiment also pinned a read snapshot and grew its WAL to 1.22 GB. Splitting a write into chunks alone did not fix that version.

Both current creation forms lack creation-pending feedback. Their form-level change handler can recount selection after title or planning edits, and obsolete count callbacks are not tied to the current filter generation. The current vote and explorer screens already bound displayed rows; loading millions of browser elements was not reproduced.

## Two backend choices

The matched stress case selects 800,000 five-letter names with availability any, no set/provider/price predicates, exclude-used enabled, seeded random order `perf-2026-10-28`, and 80 rounds of 10,000, creating all rounds. All options produced the same ordered membership digest. This is an allowed stress input, not a captured production request. The current form defaults are only five rounds of 500 with the remainder dropped.

During the measured interval, the harness requests about 40 lightweight HTTP pings, 10 vote-shaped insert/count/delete transactions and 40 counter updates per second. These are local minimal HTTP servers, not the complete Next.js application. The writes preserve the scratch database's existing votes. Heavy benchmarks ran serially.

| Configuration | Completion | Ping p95 / max | Vote-shaped write p95 / max | Process peak RSS | Latency target |
| --- | --- | --- | --- | --- | --- |
| Current application call path | 65.46 s | 628 / 864 ms | 631 / 825 ms | 266.8 MiB | Misses p95 |
| A: worker, timeout zero plus async retries | 116.48 s | 100 / 464 ms | 140 / 449 ms | 258.7 MiB | Passes |
| A: worker, existing 5,000 ms web timeout | 124.03 s | 110 / 477 ms | 134 / 447 ms | 249.2 MiB | Passes |
| B: file staging and cooperative web writes | 156.03 s | 264 / 711 ms | 261 / 680 ms | 204.7 MiB | Misses p95 |

The study target was p95 below 250 ms and maximum below one second. Do not reinterpret B's target miss as a pass. Each full-size configuration above has one successful measured sample; preliminary/warmup failures remain in the artifacts. The SQL-only first-round comparison has three repeats per variant. These are rough local measurements, not production forecasts or an intrinsic speed limit for either architecture. A uses 1,000-row chunks and timer pauses; B uses 250-row chunks and event-loop yields. Transaction count, pause policy, injected writes and the Windows filesystem affect completion time.

### A: persisted worker jobs

Accept the request after saving its job record. A dedicated worker selects and writes bounded chunks, committing progress with their effects, and publishes complete results. The small lifecycle experiment exercised admission rejection, worker termination and resume, cancellation cleanup and retry after an injected error. A real `SQLITE_BUSY_SNAPSHOT` conflict exposed a retry bug; whole-transaction retry and immediate worker transactions corrected it.

The prototype has a persisted checkpoint but does not implement authenticated Next routes, automatic whole-process recovery, leases/fencing, a sealed source manifest or deployment supervision. These are explicit requirements in the [implementation spec](implementation-spec.md), not claimed prototype guarantees. Keeping CPU work off the web thread does not remove SQLite's writer locks or the work's CPU/storage cost.

The full four-letter control used all 120,084 eligible names across 13 rounds, with three measured pairs. Median completion was 5.97 s for the current call path and 12.49 s for A. A's ping p95 ranged from 4.35 to 32.69 ms; all counts/order and existing votes were preserved. This control is larger than the separate synthetic UI sample.

### B: ordered file staging and cooperative writes

Compute one ordered selection in a read worker, write bounded JSONL records to scratch storage, close the read cursor, then replay small write transactions on the web connection with a yield between chunks. Stage each round's price data before writing it. This removes the long read/write overlap and the unbounded message queue in the first streaming version.

The full 80-round sample kept its WAL around 6.3 MB, compared with the failed cursor version's 1.22 GB. It preserves create-all intent and does not obtain its number by opening only the first round. It uses less measured process memory, but takes longer in this conservative chunk profile and does not provide accepted jobs, reload recovery or cancellation. A long request also needs a complete Next/proxy timeout check before implementation acceptance.

The separate single 800,000-name round finished in 273.87 s, with ping p95/max 448/1,032 ms. It missed both latency targets despite correct rows and zero request errors. A 250-row write still reached 1,027 ms in this case. B is not a verified full five-letter uptime fix. Its full four-letter control passed, finishing 120,084 names in 12.95 s with ping p95/max 47.7/335 ms. Runtime SQLite WAL synchronization was NORMAL; the study did not silently change it to obtain these results.

An explicit create-first choice remains available as a separate tradeoff. In three repeats without the injected HTTP load, direct selection reduced mean first-round completion from 26.72 to 18.49 s. That test freezes the same 800,000-name block but opens only 10,000 domain rows. It must not be compared as though it created all 800,000 domain rows.

## Two frontend choices

| Choice | Measured feedback | Behavior | Tradeoff |
| --- | --- | --- | --- |
| F1: guarded existing form | 13.5 ms median, three samples | Immediate pending state, disabled creation choices, duplicate guard, filter-only/coalesced counts and explicit errors | Keeps the request open; no durable status or reload resume |
| F2: ticket and job monitor | 13.3 ms median, three samples | F1 controls plus accepted ticket, server progress, reload reattachment, cancellation acknowledgement and polling backoff | Requires a backend job/status/idempotency contract |

Both variants sent zero counts for metadata edits and one count for five rapid filter edits. With one slow request followed by two new filters, they sent only the first and latest requests, with one active count. Double submission sent one create request. Removing the stale-result guard or submit latch made its corresponding check fail. These checks render actual React DOM; the baseline imports the unchanged application forms with substituted actions and a serial transport model. They do not prove deployed Server Action behavior or duplicate database writes in production.

The separate real integration uses a synthetic four-letter 10,000-row SQLite pool and the actual worker, not a timed job fixture. It created exactly 10,000 distinct rows at positions 1 through 10,000, showed a ticket, and reattached after reload with one creation POST. The recorded initial run showed the result after 600 ms. Repeating the check on the consolidated branch showed feedback in 12.9 ms, the ticket in 40 ms and the completed result in 617 ms. The initial and final integration JSON files are both retained.

F2's three timing samples use a four-second fixture job. Their approximately 114 ms ticket time and 516 ms maximum observed snapshot age are UI/protocol observations, not an 800,000-row database benchmark. Production polling intervals and account-scoped storage remain implementation decisions.

## Proposed implementation and scope

Use A plus F2 for large five-letter jobs. Apply the same admission, checkpoint and publication policy to batch opening and pool/explore creation, then cover or explicitly bound alternate large-write paths. Preserve existing filters, set aliases, deterministic order, prices, assignments, votes and views. Keep bounded pages and make cache invalidation follow publication. SQL simplification and file staging from B are useful candidates for later tuning inside the job flow, but the combined A+B throughput was not measured.

B plus F1 is the smaller change if request-bound execution and its measured latency are acceptable. Its lack of restart recovery and its p95 miss must remain visible in that choice. Neither prototype is ready to deploy by copying its files into the app.

The [implementation spec](implementation-spec.md) defines request/state contracts, writer admission, recovery, cancellation, hidden staging, resource bounds, frontend behavior and acceptance gates. Production implementation and deployment await the owner's next instruction.

## Evidence and reruns

- [Step and decision journal](journal.md), [source inventory](source-inventory.json), [source risk map](source-map.md).
- [Worker report](../2026-10-28-performance-worker.md) and [commands/raw results](../../../tools/perf/worker/README.md).
- [SQL and staged-file report](../2026-10-28-performance-sql.md) and [commands/raw results](../../../tools/perf/sql/README.md).
- [Frontend report](../2026-10-28-performance-frontend.md), [browser commands](../../../tools/perf/frontend/README.md), [cases](../../../tools/perf/frontend/CASES.md), and [mutation evidence](../../../tools/perf/frontend/results/audit.json).

The recorded machine has 12 logical CPUs, about 32 GiB RAM, Windows, Node 24.22.1 and native SQLite 3.53.4. The deployment uses Linux/Node 22. A standalone packaging smoke test and measurements on a representative deployment profile remain gates for the later implementation. The study does not claim power-loss durability or exhaustively test all filter/order combinations.

## Final checks

| Command or check | Result |
| --- | --- |
| `npm test` | Existing launcher fails on Windows before loading tests because it passes drive paths to `import()`. No test case or application file was edited. |
| `node tools/perf/run-existing-tests.mjs` | Same 20 existing tests passed, zero failures/skips, through a file-URL-compatible research launcher. |
| `node node_modules/next/dist/bin/next typegen` then `node node_modules/typescript/bin/tsc --noEmit` | Passed. Route type generation supplies the existing Next global types. |
| `node node_modules/eslint/bin/eslint.js tools/perf` | Passed. The explicit CommonJS native-module worker has a scoped require-import exception. |
| Worker contention and lifecycle scripts, SQL spool smoke | Passed again after consolidation: real extended BUSY retry, 3,000-row restart/cancel/error checks and 2,005-row exact spool replay. |
| Frontend browser suite and mutation audit | 18 browser observations and nine audit observations. Deliberately removed guards produce the expected red results. |
| Combined frontend-to-SQLite integration | 10,000 rows and distinct names, positions 1..10,000, one submission, successful reload reattachment. |
| `python tools/perf/verify-evidence.py` | Saved row/order/probe evidence is consistent. A passes the measured latency gates; B's large-case misses remain failures. See [validation.json](validation.json). |
| Original source file checksum and table counts | Unchanged from the initial inventory. See [final inventory](source-final-inventory.json). |
| Source/package/deployment diff versus `0506c5e` | Empty. Only research documentation, prototypes and results were committed. |

Disposable full benchmark database copies were removed after their handles closed, reclaiming 4.36 GB in aggregate. That is removed scratch storage, not a measured WAL peak. The original replica, source code, raw evidence and small runnable fixtures remain available.
