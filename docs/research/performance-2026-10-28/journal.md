# Local performance investigation

Status: experiments and proposed specification. Production implementation awaits the owner's choice.

## Brief and boundaries

The owner reports that creating five-letter sets containing roughly 800,000 names exhausts the server while the frontend appears idle. Four-letter work is the current priority. Compare two backend solutions and two frontend solutions using small local runs, record rough numbers, and leave an implementation specification. Do not operate on production databases or processes.

All experiments use isolated research branches from application revision `0506c5e`. Application code lives in the adjacent DomainVoter repository, rather than the quick-brand data collection repository where the session began. Original working trees and their untracked files remain untouched.

## Proposed acceptance criteria

These are study targets, not an agreed production service level.

- A local job receives acknowledgement within 250 ms; request duration does not include all row generation.
- During creation, lightweight HTTP requests have p95 below 250 ms and maximum below 1 second on this machine. Report database reads and voter writes separately from an unconditional health route.
- Exact selected membership, deterministic order, contiguous positions, prices, and assignments survive the change. Four-letter behavior remains correct.
- Duplicate submission creates at most one job. The UI shows pending, progress, completion, failure and interrupted states, and ignores stale filter counts.
- Backend work and queues are bounded. Cancellation and recovery claims require exercised evidence; otherwise they remain proposed behavior.
- No measured result from a fixture or standalone harness is described as an end-to-end production measurement.

## Evidence and comparison method

The reported hang and resource exhaustion provide the responsiveness oracle. SQL row counts and conservation of selected names provide the data oracle. A passing no-error run alone is insufficient. Compare the actual current call path against prototypes, with a four-letter control and a capped 800,000-name five-letter workload. Record filters, ordering, plan, warmup, sample count, wall time, CPU, memory, event-loop gaps and HTTP latency where available. Run heavy benchmarks serially. Local Windows numbers are comparative evidence, not a forecast for the production host.

## Timestamped work and decisions

Times are UTC on 2026-10-28. Entries are append-only.

| Time | Action or decision | Evidence and reason |
| --- | --- | --- |
| Before 14:48 | Read repository working rules and the diagnosis, test case design and React performance skills. | Reproduce the actual failure before attributing its cause. The work is research and prototypes, not the final implementation. |
| Before 14:48 | Located the application in the adjacent DomainVoter repository and fetched its factory remote. | The local original `main` was `712a9b6`; current factory main is `0506c5e`, including prior read worker, cache and chunking work. Study the latest code to avoid proposing changes that already exist. |
| 14:48 | Created isolated study, worker, SQL and frontend worktrees and research branches from `0506c5e`. | No shared branch merge, push, deployment or production operation is authorized by this study. |
| 14:48 | Installed exact locked application dependencies in the study worktree with `npm ci --no-audit --no-fund`. | 407 packages installed. Native SQLite binding verified with a memory database. Node `v24.22.1`, bundled SQLite `3.53.4`. |
| 14:48 onward | Assigned three GPT-6.1 agents at high effort to worker jobs, SQL/materialization, and both frontend alternatives. | Separate file ownership and branches; serialize heavy timing runs to avoid competition between experiments. |
| After 14:48 | Inventoried the source replica through a read-only, query-only SQLite connection and hashed it. | 984,096,768 bytes; schema v14; 2,468,782 pool names; 127,497 four-letter and 2,338,250 five-letter names. See `source-inventory.json` for the complete safe counts and hash. No user record contents were read into reports. |
| After 14:48 | Use full scratch copies for final backend measurements; disable the background free-name mover locally. | The source already has zero legacy free rows. Retain existing rounds/indexes for realistic write cost; never open the source through the application initializer, which could migrate it. |

## Candidate families

- Backend A: durable jobs with one dedicated writer, bounded chunks, progress and admission control. Test responsiveness and concurrent voter writes, not merely total completion time.
- Backend B: reduce selection, sorting and materialization work within SQLite, including creating only the initially needed rounds. Quantify any change in work performed and resulting product tradeoff.
- Frontend A: improve the current form lifecycle, filter request scheduling and stale response handling.
- Frontend B: a resumable job monitor with explicit status, bounded polling and recovery states, coupled to a backend job API.

Selection is pending measured evidence. The eventual specification must distinguish measured prototype behavior from requirements for implementation.

## Experiment updates

| Time | Action or decision | Evidence and reason |
| --- | --- | --- |
| 14:52 | Worker experiment reproduced the real `createBatch` seam with a single 800,000-name round. | 16.96 s wall time; HTTP ping p95 3,531 ms, maximum 4,354 ms; event-loop maximum 4,387 ms. This allowed configuration fails the proposed responsiveness target. |
| 14:52 | Initial worker prototype completed the same size while keeping lightweight HTTP responsive. | 30.28 s wall time; ping p95 0.91 ms, maximum 11.35 ms. Longer total duration is an explicit tradeoff. Two of 978 immediate writer probes hit BUSY, so this is not yet proof that voter writes remain responsive. |
| 14:52 | Require voter-shaped writes with asynchronous BUSY retries and test the current 5,000 ms timeout separately. | Moving a SQLite writer to another thread alone does not remove its database locks. A web connection that waits synchronously on those locks can still stall the process. |
| 14:52 | Standardize a second stress case: random seed `perf-2026-10-28`, length 5, availability any, cap 800,000, exclude used, 80 rounds of 10,000 names. | This distinguishes per-round stalls from batch freeze/sorting cost. The actual production submission payload is unavailable. Current UI defaults are 5 rounds of 500 with remainder dropped, which materializes only 2,500 domains even when the frozen block is large. Do not claim the stress plan was the owner's exact request. |
| 14:52 onward | Release worker pilot slot to SQL comparisons; keep frontend tests on fixtures. | Avoid overlapping backend timings. Prototype A recovery tests and final repeated runs follow SQL. |
| 14:54 | Worker lifecycle experiment on 3,000 synthetic rows completed. | Terminate a worker after a committed checkpoint, resume to exactly 3,000 names in three rounds, reject concurrent admission, cancel partial data and retry an injected error. This is worker termination, not whole-process or power-loss recovery. |
| 14:58 | Review the experiment oracles and measurement boundaries with the test-red-team skill. | Add an independently computed expected snapshot count. Require the external HTTP probe to stop and drain all in-flight requests before collecting results, so slow writes are not omitted. Initial non-drained pilot numbers remain preliminary; final repeated worker runs use the corrected protocol. |
| 14:59 | Repeated SQL first-round comparison completed. | Three samples each, with identical ordered membership. Final numbers live in the SQL report. SQL simplification alone still leaves synchronous round writes and is not a complete uptime solution. |
| 14:59 | Review frontend prototype before accepting its results. | Correct missing submitter/create-mode capture, unknown-total progress, and StrictMode mount handling. Require a slow-count coalescing case so obsolete counts cannot queue without bound. |
| After 14:59 | Streaming price cursor exposed growing WAL during cooperative materialization. | A retained read snapshot can pin checkpoint progress while bulk writes run. Preserve the unsuccessful experiment as evidence, then compare a spool-to-file read that closes the cursor before SQLite writes. Do not present chunking alone as a disk bound. |
| 15:02 | Close the unsuccessful streaming experiment and preserve its raw result. | Single 800,000-name round: 157.38 s wall time, 1,477 ms maximum timer gap, 1,461 ms longest 2,000-row write, WAL 1,223,701,832 bytes. Counts and order were correct, but the proposed latency gate failed. |
| After 15:02 | Frontend B completed a real worker integration using 10,000 synthetic four-letter names. | First-frame feedback 14.1 ms, ticket visible 40 ms, completion visible 600 ms; reload reattached with one POST. SQLite has exactly 10,000 distinct rows at positions 1 through 10,000. This is a synthetic integration check, not a full-replica benchmark. |
| After 15:02 | Worker standardized warmup with active vote-shaped probes exposed `SQLITE_BUSY_SNAPSHOT`. | Worker had staged 800,000 names and inserted 1,000; hidden results were not published. Retain this failed run. Retry the entire rolled-back transaction for extended BUSY codes, and reproduce the upgrade conflict on a small fixture before repeating the large run. |
| After 15:02 | Narrow full-size repetitions to keep the study a small local sample. | Existing SQL comparisons have three primary repeats. Worker comparisons include corrected warmup and one post-warmup primary pair, plus small controls and the timeout compatibility check. Report exact sample counts instead of implying statistical precision. |
| After 15:09 | Corrected standardized worker sample completed with all probes drained. | Current code 65.46 s versus worker 116.48 s; ping p95 628 to 99.7 ms; vote-shaped write p95 631 to 139.9 ms. Worker completed 1,074 successful vote-shaped transactions with zero HTTP errors and matching 800,000-name membership/order. Report the 1.78x completion cost under the injected load. |
| After 15:13 | Full 5,000 ms web-timeout compatibility sample also passed. | 124.03 s, ping p95/max 110.4/476.6 ms, write p95/max 134.5/447.0 ms, 1,146 successful writes, no HTTP errors. This overturns the initial assumption that web timeout zero and a vote refactor are necessary. Keep that policy conditional on measured latency rather than adding an unsupported mandatory change. |
