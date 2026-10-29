# Dedicated background writer study

Research prototype only, 2026-10-28. No application source changes. Approval is required before implementing this design in the application.

The dedicated writer improved responsiveness but took longer to finish under injected concurrent writes. In the matched 80-round, 800000-name sample, current code took 65.46 seconds and the prototype took 116.48 seconds. HTTP ping p95 fell from 628 ms to 99.7 ms; vote-shaped write p95 fell from 631 ms to 140 ms. This is one full-size comparison, sufficient for a rough choice but insufficient to estimate production speed.

The real `createBatch` path still opens each planned round through a synchronous `openBatchRound` transaction. The allowed one-round, 800000-name pilot produced a 4354 ms HTTP ping maximum. No production implementation was changed.

## Inputs and reproduction

Code base `0506c5e`, full local database replica, schema 14. Source SHA-256 `702cec4e66aa52ed76f94c329a329b2237146ddc0a01232302f898642a411f85`. Source size 984,096,768 bytes. The source stayed untouched. Only a gitignored scratch copy was opened writable. The free-name mover was disabled with `DV_FREE_MOVE=off`.

The source contains 2,468,782 pool rows, including 127,497 four-letter rows and 2,338,250 five-letter rows. Existing application rows and indexes remain in the replica. No names, user values, credentials, or infrastructure addresses appear in saved results.

The harness uses the real TypeScript modules through the same Jiti pattern as `tests/run.mjs`. Reader workers are enabled with `DV_RO_WORKERS=2`. A minimal HTTP server shares the main thread and database connection with the measured operation. Another thread sends local HTTP pings every 25 ms. This catches synchronous event-loop stalls even when the server's own timers cannot run. It does not measure Next.js rendering, authentication, network latency, or a production host.

Pilot reproduction command, from this worktree:

```powershell
node tools/perf/worker/measure.mjs baseline-batch 5 800000 pilot
```

Pilot configuration: length 5, availability any, no set/provider/class/price predicates, order name, cap 800000, excludeUsed false, one 800000-name round, createNow 1. The four-letter pilot uses cap 10000. This is an allowed worst case, not a claim about the reporting user's precise form values. The UI default and the standardized 80-round stress case differ.

## Hypotheses and evidence

1. A whole-round synchronous write still blocks the event loop. Prediction: the 800000-name single round shows a multi-second ping gap, while a writer thread removes that gap. The pilot supports this.
2. Selection and sorting dominate some elapsed time. Prediction: changing the read ordering or cap changes job duration even if HTTP pings remain fast. Keep ordering fixed for the primary comparison.
3. A background connection can still stall web writes through SQLite's synchronous busy wait. Prediction: keeping the current 5000 ms timeout can create ping or vote latency spikes; timeout 0 plus asynchronous retry avoids waiting on the main thread. The pilot had two busy conflicts, so moving the worker alone is insufficient.
4. Frontend work can add an independent delay after creation. Prediction: browser completion may lag the minimal server result. This study does not test that hypothesis.

## Pilot results

Each row is one early sample, not a stable average. The pilot preceded the final HTTP vote probe, drain protocol, reader priming, and fresh-copy reset additions. Its runs reused the scratch database sequentially and used name ordering. In-flight requests at shutdown were not explicitly drained, so its latency values may omit late completions. Compare responsiveness direction, not throughput ratios.

| Case | Wall seconds | Ping p95 ms | Ping max ms | Loop max ms | Sampled RSS MiB | CPU user/system seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current batch, 4L 10000 | 6.755 | 1.31 | 87.92 | 116.06 | 323.2 | 0.859 / 1.781 |
| Writer, 4L 10000 | 0.889 | 3.40 | 10.34 | 18.92 | 221.7 | 0.250 / 0.344 |
| Current batch, 5L 800000 | 16.961 | 3530.99 | 4354.46 | 4387.24 | 280.7 | 6.563 / 4.062 |
| Writer, 5L 800000 | 30.283 | 0.91 | 11.35 | 30.77 | 281.9 | 7.110 / 3.563 |

All pilot outputs had the expected count, unique names, and positions from 1 through the requested count, with zero alphabetical-order errors. The writer pilot used 1000-row transactions and 5 ms pauses. Two of 978 lightweight write attempts encountered `SQLITE_BUSY`; the initial pilot counted those attempts rather than retrying. Those are not successful voter writes.

## Primary measurement protocol

The standardized stress input is random order with seed `perf-2026-10-28`, length 5, availability any, cap 800000, excludeUsed true, 80 rounds of 10000, remainder extra, create all. Four-letter controls use the same predicates and plan, capped at 800000, and therefore stop at their actual eligible row count. Each raw JSON records the complete arguments.

Set `PERF_SOURCE` to the local canonical replica file in the shell, outside tracked files. The harness copies that file to `data/perf-worker/voting.db` before each invocation. Copy time and module startup are outside the timed interval. Only explicit scratch WAL/SHM files are removed. Never point the harness at an application directory. To reproduce:

```powershell
$env:PERF_STANDARD='1'
$env:PERF_BUSY_MS='0'
node tools/perf/worker/measure.mjs baseline-batch 5 800000 warmup
node tools/perf/worker/measure.mjs worker 5 800000 warmup
node tools/perf/worker/measure.mjs baseline-batch 5 800000 r1
node tools/perf/worker/measure.mjs worker 5 800000 r1
```

The final comparison deliberately uses one fresh five-letter pair after preliminary warmup work, three four-letter pairs after a control warmup, and one five-letter compatibility sample. This is a rough choice study, not a stable five-letter speed estimate. `run-series.ps1` reproduces that continuation. No other heavy benchmark should run concurrently. Use `PERF_BUSY_MS=5000` for the compatibility check. Results live alongside the prototype. The source path is supplied locally and is not recorded in result JSON.

Final harness metrics include elapsed time, process CPU during creation, sampled RSS, process high-water RSS, event-loop delay, external-thread HTTP pings, and HTTP vote-shaped write completion. Both reader workers are primed with `SELECT 1` outside the measured interval. The write operation uses actual copied `votes` indexes and foreign keys with existing local numeric identifiers, inserts an absent vote, reads a count, and deletes it in one transaction. Each operation leaves the original votes unchanged. It does not call the Next server action or authenticate a user. The worker case uses asynchronous 5 ms retries with a 5-second deadline for all `SQLITE_BUSY` extended codes; failed HTTP writes and retries are counted explicitly. Worker retry counters are separate from web retry counters. A separate lightweight counter records lock availability. After creation finishes, the probe stops scheduling and drains every in-flight request before metrics are saved. Socket timeouts are 12 seconds and the drain deadline is 15 seconds, both longer than the retry deadline. HTTP status codes, timeouts, and network errors are recorded; none may silently disappear at shutdown. Started/completed request counts must agree.

Completion checks include aggregate count, distinct names, round count, and positional agreement with the frozen batch items. A SHA-256 digest over ordered output names permits baseline/prototype comparison without disclosing names. Sampled RSS can miss a peak during a synchronous stall, so use process high-water RSS as the conservative peak metric. CPU is process CPU, not isolated SQLite CPU. Local Windows filesystem caches, antivirus, scheduler noise, and a small number of runs limit extrapolation.

## Matched results

Local machine: Windows x64, Node 24.22.1, i7-10750H, 12 logical CPUs, 31.9 GiB RAM. The test schedules a ping every 25 ms, a vote-shaped write every 100 ms, and an additional lightweight counter write every 25 ms. Those counter commits deliberately add writer contention. Actual completed request counts are recorded; scheduled frequency is not a guaranteed achieved rate. These durations describe that load and machine, not a production forecast.

| Case | N | Wall seconds | Ping p95 ms | Ping maximum ms | Vote write p95 ms | Vote write maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current 4L | 3 | 5.97 median, 5.83-6.37 | 344-943 | 1242 | 422-1020 | 1227 |
| Writer 4L, timeout 0 + retry | 3 | 12.49 median, 12.14-12.75 | 4.35-32.69 | 392 | 48.14-77.96 | 392 |
| Current 5L | 1 | 65.46 | 628.10 | 863.87 | 631.33 | 825.34 |
| Writer 5L, timeout 0 + retry | 1 | 116.48 | 99.72 | 463.93 | 139.86 | 448.89 |

Every matched result conserved names and positions, preserved original votes, and recorded zero HTTP errors or failed vote-shaped writes. Four-letter jobs contain 120084 eligible names across 13 rounds; five-letter jobs contain 800000 names across 80 rounds. Ordered-name digests match across baseline and writer, including all repeated controls.

For five letters, current code used 55.25 seconds of process CPU and 266.8 MiB high-water RSS. The writer used 91.97 CPU seconds and 258.7 MiB RSS. All 2723 baseline and 4836 writer probe requests, including 200 ms of probe priming traffic outside the reported latency window, completed before shutdown. The measured windows contained 604 and 1074 successful vote-shaped writes respectively. The writer retried 1296 web busy conflicts and 223 worker busy conflicts. No vote conflict was silently dropped.

The writer recorded 1600 data chunks. Its largest chunk operation took 338 ms including asynchronous retry wait. That is not a measured SQLite lock-hold duration and does not establish a 20 ms bound. An eventual adaptive budget must separately measure successful transaction duration including commit, without retry sleep. The 1000-row limit alone did not establish the proposed time target.

Raw samples and `summary.json` sit under `tools/perf/worker/`. Regenerate the summary with `node tools/perf/worker/summarize.mjs`. The successful baseline warmup was 64.97 seconds, separate from the table. The first worker warmup failed and is reported below, never counted as a successful sample.

One full-size compatibility sample kept the current web connection's 5000 ms busy timeout while retaining bounded worker transactions. It finished in 124.03 seconds, with ping p95/max 110.41/476.61 ms and vote-shaped p95/max 134.49/447.05 ms. All 1146 measured vote-shaped requests succeeded, with no web busy retries or HTTP errors; counts and order matched. The current timeout did not introduce an additional stall in this sample. A requirement to change the web timeout to zero is not established by these measurements.

## Prototype behavior exercised

`queue.mjs` durably inserts a job record and hidden round metadata, then returns acceptance. Its admission transaction rejects a second active job. `writer.mjs` selects names off the main thread, stages at most 1000 names per transaction, and copies at most 1000 domain rows per transaction. Every data write and its progress checkpoint commit together. Round boundaries also constrain chunks. Rounds open only after the entire job finishes. A worker failure never falls back to heavy work on the web thread.

`recovery.mjs` creates an independent 3000-row synthetic pool and checks lifecycle behavior:

- A second submission is rejected while the first is active.
- The worker is forcibly terminated with exit code 1 after staging 3000 names and materializing 200. A new worker resumes from the persisted checkpoint and completes exactly 3000 names across three 1000-name rounds.
- No partial round opens before completion.
- Cancellation after partial materialization removes all owned batch items and rounds in bounded chunks.
- An injected worker error persists `error`; an explicit retry resumes to exactly 3000 rows.

Command: `node tools/perf/worker/recovery.mjs`. Result: assertions passed, exit 0. Raw evidence: `result-recovery.json`. This is a worker termination check, not a power-loss or whole-process restart test.

The first standardized worker warmup failed after staging 800000 names and materializing 1000. The worker read a round inside a deferred transaction, a web probe committed meanwhile, and the worker's write upgrade raised `SQLITE_BUSY_SNAPSHOT`. Its initial retry matched only the base `SQLITE_BUSY` code. The job persisted error and published zero rounds. Raw failure evidence remains in `result-worker-warmup-busy-snapshot-failure.json`; it is excluded from successful timing samples and has no completed latency metrics.

The correction retries the entire rolled-back transaction for all `SQLITE_BUSY` extended codes. Worker transactions now use `BEGIN IMMEDIATE`, acquiring the writer reservation before reading their metadata. Web and UI retries use the same helper. `node tools/perf/worker/contention.mjs` reproduced the real extended error with two WAL connections, then passed with two attempts and a final counter value of 2. That value proves the competing transaction and exactly one successful retry committed. The lifecycle exercise passed again after the correction.

The separate frontend study used `ui-adapter.mjs` for a browser-to-worker-to-SQLite check with a synthetic four-letter 10000-name pool. Its ticket appeared in 40 ms, nonzero progress in 337 ms, and completion in 600 ms. Reload reattached without a second submission. SQLite contained exactly 10000 unique names at positions 1 through 10000. This is a small integration check, not a replica throughput result. Evidence in the consolidated study: `tools/perf/frontend/results/integrated.json` and `docs/research/2026-10-28-performance-frontend.md`.

## Proposed implementation contract

This section is a proposed specification. Prototype coverage is narrower than the full contract.

### Submission, progress, and visibility

An authenticated admin submits a validated immutable request with an idempotency key. Validate filters, seed, source mode, cap, plan, assignees, and permissions before reserving capacity. Persist the job and reservation before returning HTTP 202 with its identifier. A duplicate key with identical input returns the existing job. A conflicting reuse returns 409. Capacity exhaustion returns 429 with Retry-After. Do not silently queue unlimited work.

Start with one active bulk writer and no additional waiting job, matching the prototype admission policy. Set explicit limits for selected rows, staged bytes, disk reserve, and runtime. The deployment must reserve enough space for staged names, domain indexes, WAL, and rollback cleanup. Exact byte limits require measurement on the deployment volume before approval.

Status exposes queued/running/cancelling/done/cancelled/error, phase, frozen total, staged rows, materialized rows, completed rounds, created identifiers, timestamps, and a stable error code. Progress only reflects committed checkpoints. An active status response must remain bounded, with no full domain payload or repeated whole-pool count. Persist the final result so reloading the page or losing an HTTP response cannot lose it.

All new rounds remain hidden from voters until the chosen publication boundary commits. Proposed default: publish the whole requested creation job atomically. If the owner wants first-round availability earlier, specify that boundary explicitly and forbid later cancellation from deleting an already published round. Assignees, filters, ordering, prices/currency behavior, provenance, and existing remainder semantics must match the current operations.

### Worker, lock policy, and recovery

Use a separately supervised writer process or worker thread with its own connection. A process provides better failure isolation; the prototype uses a thread. Keep sorting off the web thread. Do not use the reader's current inline fallback for queued heavy work. A missing worker leaves accepted work queued or reports a retriable operational error.

Use transactions bounded by both row count and a measured time target, initially 1000 rows with a 20 ms target. Adapt down when writes exceed the target, and yield outside the lock. A time target cannot interrupt an already running SQLite statement. The hard upper bound comes from a conservative row limit, query plans, and cancellation at chunk boundaries. Keep heavy-worker retries asynchronous and bounded, including `SQLITE_BUSY_SNAPSHOT`, and acquire a writer reservation before chunk metadata reads. Measure successful transaction duration including commit separately from retry sleep.

The compatibility check supports retaining the current web busy timeout for an initial implementation with bounded bulk writes. Treat timeout 0 plus asynchronous retries as a separate proposed policy if target-host measurements show unacceptable waits. Changing the shared connection to timeout 0 requires auditing every synchronous write caller, not only votes. If adopted, retry whole rolled-back idempotent vote/view transactions and preserve action idempotency under network retries. A retry deadline must return a visible retriable error, never a dropped vote. This study's timeout 0 and 5000 ms cases both passed the local latency thresholds.

Persist worker ownership, a lease/heartbeat, attempt count, phase, cursor, and a source manifest identity. Only one supervisor may reclaim an expired lease. Fencing prevents a stale worker from publishing or advancing a reclaimed job. Worker exit alone must not mark a committed job done. On startup, inspect unfinished jobs, verify checkpoints and owned resources, then resume or fail with a stable code. Supervisor leases, fencing, automatic startup recovery, and whole-process crash recovery are spec-only here.

Freeze the selected ordered names before materialization. The prototype recomputes its selection after a crash during staging, assuming an immutable pool. Production must use a sealed immutable manifest, or validate a source revision and exact selection digest before resuming. A changed source must fail safely rather than splice two selections. Seal and checksum a streamed manifest outside the SQLite writer transaction, then checkpoint its durable file identity. Publish the manifest by atomic rename and test process/power-loss behavior on the target filesystem. This manifest protocol is spec-only. Existing price lookup semantics must be deliberately preserved or separately approved if prices also become frozen.

### Cancellation, errors, and cleanup

Cancel is idempotent and records intent. Workers check intent between chunks. Sorting may delay cancellation until its current read statement returns. Cancellation is not complete until all unpublished owned rows are removed. Clean data in bounded transactions, verify owner/job links before deleting, and keep the final cancellation record. Completed published jobs cannot be cancelled. Never infer ownership from titles, age alone, or broad filters.

Transient busy conditions retry asynchronously within a deadline. Constraint violations, missing source data, disk exhaustion, invalid manifests, and permission changes become explicit errors. Keep unpublished rows hidden and retain a bounded error code and checkpoint. An explicit retry may resume only after source/ownership verification. Cleanup and error retention consume admission capacity until their reserved resources are released. Prototype admission does not account for errored-job disk reservations.

### Required call sites and acceptance checks

Route every large materializing path through the same admission and checkpoint policy: pool round creation, explore round creation, batch freeze, batch opening including open-next, derived/next rounds, and large imports/supplements. Large exports need bounded reader concurrency and backpressure, but should not enter the single writer queue unless they mutate data. Audit reader request limits and replace heavy inline fallback with a safe error or queued retry. The prototype implements one batch creation shape only; none of these application integrations are implemented.

Required acceptance checks for the eventual application implementation:

- At least three fresh-replica trials after warmup for both four-letter control and five-letter 800000 stress, with fixed arguments and no concurrent benchmark. Report failures and variance.
- HTTP ping p95 below 250 ms and maximum below 1000 ms during creation; count and latency of successful vote-shaped writes; no silent busy drops.
- Matching selected names/order, exact per-round positions, expected remainder behavior, existing data unchanged, preserved assignees and provenance.
- Terminate before/after a checkpoint, during staging, between rounds, during publication, and during cleanup. Restart automatically without duplicates or early visibility.
- Idempotency, cancellation races, repeated cancel/retry, lease expiry and stale writer fencing, invalid input, queue saturation, changed source, and disk-full behavior.
- Next.js route/action and browser checks after production implementation. The minimal HTTP harness does not satisfy those integration checks.

## Decision

Keep this option for explicit job progress, bounded resource use, and recoverable multi-step work. The matched sample supports better responsiveness with a 1.78x elapsed-time cost under the injected load. It is more implementation work than splitting a SQL statement or deferring round creation. Choose it for its job lifecycle and voter responsiveness only if that cost and implementation scope are acceptable. More full-size runs belong in implementation acceptance, after choosing a design.
