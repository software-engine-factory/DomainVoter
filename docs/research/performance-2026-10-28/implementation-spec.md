# Proposed implementation specification

Status: proposed for owner selection. This document does not authorize production work or claim that every requirement below is implemented in the prototypes.

Base application revision: `0506c5e`. The study uses the local schema v14 replica described in `source-inventory.json`. Preserve existing set aliases, selection filters, seeded order, voting rules, assignments, prices and currencies. Do not substitute a different product behavior to obtain a faster benchmark.

## Backend A: durable background jobs

### Request and state contract

An authenticated administrator submits normalized filters, ordering, seed, cap, exclusion rules, round plan, assignees and an idempotency key. Validate bounded safe integers and the full plan before queuing work. Return `202` with a job id after durable acceptance, rather than holding the request until all rows are created. Enforce administrator access on submission, status, cancellation and result routes.

The durable record contains job kind, owner, normalized input, idempotency key, input fingerprint, state, phase, phase counters, attempt, lease/fencing token, heartbeat, cancellation request, result ids and a safe error code. A repeated key with the same input returns the existing job; reuse with different input is a conflict. Apply the next available numbered migration only during the later implementation.

States are `queued`, `running`, `succeeded`, `failed` and `cancelled`. A heartbeat expiry makes a running attempt eligible for recovery, not a completed failure by itself. Every state change must check the current attempt token so a stale worker cannot publish after its replacement starts.

Phases are selection, freezing membership, creating round rows and publication. Selection can have an unknown total. Report an indeterminate state until the total is known. Report committed progress per phase, not an invented overall percentage.

### Resource and database contract

- Run one admitted heavy writer across the application deployment. Do not allow each request or Node process to create its own independent queue. Reject or queue additional jobs explicitly within a bounded capacity.
- Run expensive selection and materialization outside the web event loop. Reuse existing read workers only through a bounded lane; reserve interactive read capacity so a job cannot fill the queue with previews or exports.
- Freeze membership and its deterministic ordering once. Preserve the current meaning of opening a round from frozen membership; do not silently change when prices are read. Bound transferred batches with explicit acknowledgements and producer backpressure.
- Commit small chunks with a measured time budget. Row count alone is not a duration guarantee. Adapt chunk size and yield between chunks. Persist checkpoints in the same transaction as their effects.
- Measure web write lock waits as well as worker execution. Both the zero-timeout/asynchronous-retry experiment and the current 5,000 ms setting passed the full local sample with bounded worker chunks. The measurements do not establish that changing the web timeout or refactoring existing votes is necessary. The initial implementation may retain the tested setting if the latency gates pass on the deployment profile. If introducing asynchronous retries, retain an idempotent vote/view effect, include extended BUSY codes such as `SQLITE_BUSY_SNAPSHOT`, and retry the entire rolled-back transaction rather than only its last statement. Acquiring the worker's writer reservation with an immediate transaction avoids its read-to-write upgrade race. Do not replay a toggle after an ambiguous acknowledgement; use a desired-state mutation for network-retryable requests.
- Handle WAL growth and checkpoints outside latency-sensitive web work. Measure WAL size, checkpoint time and available disk under the representative workload before choosing limits. A worker thread does not remove SQLite's single-writer constraint.
- Worker failure must fail or resume a job through the durable record. Never fall back to running a large job inline on the web thread.

### Publication, cancellation and recovery

Incomplete rounds remain unavailable to voters and are excluded from ready-result summaries. Publication atomically marks only complete results ready, then invalidates dataset/client caches once. Existing `closed` rounds are a product state; a build must be distinguishable from an intentionally closed round.

Check cancellation at every committed chunk boundary. Cancellation stops further work and removes or marks only artifacts owned by that job. Never delete pre-existing rounds, votes, views or pool rows. Use bounded cleanup, since a synchronous deletion of hundreds of thousands of partial rows can reproduce the same stall.

After termination, resume from the last committed checkpoint without duplicate membership, positions, rounds or assignments. Retryable errors retain their checkpoint. A non-retryable error reports a safe reason and preserves enough state to inspect the failure. A heartbeat monitor must distinguish a blocked worker from ordinary long selection.

### Entry points

Apply the contract first to batch creation and round materialization, including open-next actions and pool/explore round creation. Before declaring the application's large-work path fixed, include or explicitly bound CSV creation/import, derive/next rounds and supplement application. Audit expensive synchronous round aggregates separately. The small prototype does not prove all these paths are fixed.

## Backend B: reduce query work and defer optional materialization

Keep SQLite and the current frozen membership schema. Replace nested ranking/window/ordered-aggregation selection with one ordered cursor and sequential positions, preserving the same seed and tie-breaks. Use the existing filter builder and compare exact ordered membership before accepting the change. Inspect query plans for representative set, length, availability, exclusion and price filters; introduce an index only when the measured plan justifies its ongoing write/storage cost.

Stream selection with acknowledgements and bounded buffers. The current read worker's chunk API does not have backpressure, so merely switching to that API is insufficient for a memory bound. Retain a consistent selection snapshot and release it promptly to avoid pinning the WAL indefinitely. The measured cursor variant grew a large WAL, so the next prototype spools ordered data to a scratch file inside a read worker, closes that read cursor, then replays bounded chunks into SQLite. Treat scratch-file space and cleanup as explicit resource requirements.

An administrator may choose to freeze the whole 800,000-name block and create only the first useful round. This preserves frozen membership but reduces immediately available rounds. It must remain an explicit choice. A request to create all rounds must still create all rounds, with bounded materialization or backend A.

This option reduces work and time to the first usable round. It does not by itself provide durable acceptance, recovery, cancellation, queue admission or protection from a single huge synchronous round transaction. The final comparison must state those limitations next to its speed measurement.

## Frontend A: improve the current form

Set pending feedback before awaiting creation, disable every creation choice, preserve the selected create mode and show an accessible busy state. Protect the mounted form from duplicate submission with a synchronous latch as well as the disabled state. Keep the form editable after a definite validation/rejection error. For an unknown submission outcome, require checking status or reconnecting before a blind replay.

Derive a canonical count key only from membership filters. Titles, seed/order and round split metadata do not change selection count and must not trigger a recount. Cap changes can reuse an uncapped count where exclusion and dataset versions permit. Debounce membership edits, allow at most one active count and one latest pending request, and apply a result only if its generation/key still matches. Display updating or error state instead of presenting an obsolete count as current. Server Actions currently dispatch serially, so use coalescing rather than assuming browser abort cancels queued server work.

Keep paginated result rendering. Existing grid/explorer page limits already prevent rendering millions of tiles. Do not load the entire dataset into the browser or promise that a spinner repairs backend stalls.

## Frontend B: resumable job monitor

Build on frontend A's count scheduling and immediate feedback. Submit to backend A and persist the returned job identity in a user-scoped local record. On navigation or reload, fetch authenticated job status and reattach to that job without submitting a second creation request. Do not store or reuse another signed-in user's job record.

Show queued/running phase, committed processed/total values, last update age, cancel requested, failed, cancelled and completed states. Unknown totals are indeterminate. Enable the result link only after publication. A cancellation click remains pending until the server confirms its state.

Use bounded polling, initially about one second while visible, with backoff on status errors and reduced activity while hidden. Refresh immediately when visibility returns. Stop polling at terminal states. Polling is the initial proposal because it is simple to resume and inspect; use SSE only if measured status freshness justifies its extra connection/reconnect contract. Treat these intervals as implementation starting values, not measured production guarantees.

Persist the idempotency key before submission so a lost acceptance response can be reconciled safely. A status timeout means status is unknown, not that creation failed or should be resubmitted. Escape server errors into product-level messages and offer a bounded retry or reconnect action.

## Required implementation gates

The final implementation must pass these gates on scratch databases before any separate deployment decision.

1. Run the recorded four-letter control and the 800,000-name five-letter cases with the exact input in the benchmark artifacts. Test both a single huge round and many bounded rounds. Report first-ready time and total completion time separately.
2. Measure lightweight HTTP latency, actual paginated card/database read latency and idempotent voter-write latency under job load. Proposed local targets are acknowledgement below 250 ms, p95 below 250 ms and maximum below one second. Enforce zero lost votes and no skipped write attempts. Record p95, maximum, CPU, peak RSS and peak WAL, not just the average.
3. Verify independent selected counts, exact characterized ordered membership, distinct names, contiguous positions, expected number of rounds, current price/currency behavior, assignments, and unchanged pre-existing votes/views. Cover length 4 and 5, each active set and relevant intersections, sale/free/any, seeded and name orders, exclusion on/off, empty and cap boundaries, and remainder rules.
4. Submit twice, submit from two sessions, restart during selection and each write phase, inject an error, lose the acceptance response, cancel and restart. Check single ownership, checkpoint recovery, no partial publication and bounded cleanup. A passing small lifecycle test does not prove all concurrency schedules.
5. In a browser, test immediate pending feedback, no metadata recounts, rapid filter edits, stale responses, definite and unknown errors, resume without resubmit, cancellation acknowledgement, terminal polling stop, session changes and bounded rendered rows.
6. Use the app's deployment Node version and packaged standalone build for a local packaging smoke test. Verify worker modules and native SQLite bindings exist in the built artifact. The study's Windows Node 24 numbers do not establish Linux Node 22 performance.
7. Keep current test and lint gates passing. Add targeted regressions at the actual job/action seams rather than mirroring implementation functions. Do not run live provider or paid calls.

## Scope of approval

The owner chooses backend and frontend options after reading measured results. The recommendation and its evidence will be recorded in the study report. Production operation, schema application and deployment are later work, requiring the owner's instruction.
