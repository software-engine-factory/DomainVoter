# Backend B: spool before bounded SQLite writes

Research and prototype only. No application code changed. This option keeps SQLite and the frozen batch membership model. It reduces query work, copies selected rows to a temporary file in a read worker, closes that snapshot, then replays short write transactions on the main connection. It can create every planned round. Opening only the first remains a separate product choice. Durable jobs and restart recovery remain separate work.

The measured B profiles do not meet the proposed responsiveness target for large builds. Prefer the durable writer alternative for liveness. Retain B's direct SQL and spool results as possible optimizations, or choose its simpler execution model only with that measured limitation and the missing recovery guarantees understood. This study reproduces local request delays at the real database seam. It does not reproduce a production crash or prove the cause of reported server exhaustion.

## Evidence and scope

The offline replica is 984096768 bytes, schema version 14, SHA256 `702cec4e66aa52ed76f94c329a329b2237146ddc0a01232302f898642a411f85`. It contains 2468782 pool rows, 7413 domains, 11 rounds, and 157167 frozen batch items. Label counts are 3035 at length 3, 127497 at length 4, and 2338250 at length 5. `free_names` is empty. The checked application also ends at migration 14, so the benchmark needs no schema upgrade. This does not establish that the backup equals the running service's current data, query statistics, hardware or configuration.

The source is opened read-only. Every run copies the complete replica into ignored scratch storage, retaining its existing indexes and domain rows. No user records enter results. The local Node runtime uses better-sqlite3 with SQLite 3.53.4. The Python inventory used SQLite 3.50.4, but no Python timings are compared with Node timings.

`createBatch` currently applies a capped ordered subquery, numbers it with another ordered window, then builds a newline string with ordered aggregation. `openBatchRound` synchronously inserts every domain in that round in one transaction. The prototype replaces the first three operations with one ordered cursor, assigns frozen positions as rows arrive, and retains the same chunked item inserts. It still calls the real `openBatchRound`.

The actual form defaults to 5 rounds of 500 names and dropping the remainder. A capped 800000 name block therefore does not by itself imply 800000 materialized domain rows. The stress plan in this study explicitly uses 80 rounds of 10000 names, extra remainder handling and create all. The reported failing request's exact plan was unavailable.

## Contracts for implementation

1. Keep FNV rank and the name tie breaker exactly. Cap after ordering, not before it. All six order modes need independent parity coverage. This prototype covers seeded random and name order only.
2. Freeze names and their order from one read snapshot. A keyset query per chunk without a held snapshot can admit concurrent imports or skip names that change eligibility. Use one cursor with backpressure, or a short explicit read transaction over a versioned source. Long WAL readers can delay checkpoints, so monitor WAL size.
3. Materialize prices when opening each round with `COALESCE(lp_price,best_price)` and `lp_currency`, as today. Free registration prices are not current voter prices. Freezing prices earlier would change behavior.
4. Preserve assignment inheritance via `copyBatchAssignees`. No assignment means everyone. The prototype supplies an empty assignment list and does not prove restricted visibility parity.
5. Keep `excludeUsed` tied to materialized `domains.pool_name` unless the owner explicitly chooses reservation semantics. Freezing a batch does not currently reserve its future names. Changing this is a product decision, not an SQL optimization.
6. Keep planned round sizes, extra/last/drop remainder rules and one-based positions. Never mark a partially built round open. Opening a large round needs chunked writes to a closed staging round, followed by one publish transaction.
7. Do not promise create all and return after opening one. Present a separate choice to open first now and defer later rounds. Alternatively create all as a durable background job and report actual completed rounds.

## Proposed SQL changes

Use `SELECT p.name ... ORDER BY <existing exact order> LIMIT ?` directly. Remove the `ROW_NUMBER` and `group_concat` layers. The worker computes order once; the coordinator derives `position = priorWritten + chunkIndex + 1`. The initial queue experiment proved that merely streaming existing reader chunks increases RSS. Its price cursor also held a SQLite read snapshot while domain writes accumulated a 1223701832-byte WAL. The replacement protocol therefore spools to disk before replay rather than keeping that cursor open during writes.

For each selection or price snapshot, a dedicated read-only worker opens the scratch file exclusively, writes JSONL in buffers of at most 2000 rows, finalizes the cursor and closes SQLite, closes the file and returns only row/byte counts. The main process replays the file using a 64 KiB read buffer and a configurable row chunk. It removes the file after successful replay. For round materialization, the spool includes the exact position, name, current `COALESCE(lp_price,best_price)` and `lp_currency` so every row comes from one price snapshot. Assignment copying and publication happen together after all domain rows are written. The prototype evaluates 250-row transactions and `setImmediate` to yield one event loop turn between transactions. Transfer buffers are bounded; SQLite sorting memory and the full spool's disk consumption remain separate resources.

Before any build, reserve enough scratch space for the capped snapshot, price spool and expected WAL/index growth, and enforce one build at a time. Name the files by an unguessable build token under the application's data directory, use exclusive creation, validate every replayed row and count, and clean abandoned files through a build ledger or an explicit operator command. A disk-full error must close readers, hide incomplete work and surface a retryable failure. File contents are internal artifacts and must never be exposed through download routes.

Store batch status `building` before the first chunk, exclude it from normal lists, finalize `ready` after the full snapshot and assignment writes, and clean up interrupted builds. Whether that status is an additive column or a small build ledger is an implementation choice for review. Neither requires a new database engine. B may return an explicit interrupted status after process loss; automatic job recovery is the durable worker option's guarantee.

Concrete code changes would replace `orderedNames` with a spool handle in `bulk-fill.ts`, add a fail-closed spool operation to `ro.ts`, and make both `createBatch` and `openBatchRound` asynchronous staging operations in `batches.ts`. `openNextBatchRoundAction` must await each bounded build and yield. `pool.ts` gets the capped-count optimization only if its separately measured improvement justifies it. Ordinary voter queries, schema price meaning, the FNV function and assignment visibility remain governed by their existing contracts.

For name ordering, evaluate a `(name_len,name)` index on the replica before scheduling a migration. Existing `(name_len,avail)` only produces name order when availability is constrained to one value. For seeded random ordering no static index eliminates the seed dependent rank sort. Avoid adding one index per possible filter combination.

For capped calculator counts, evaluate `SELECT COUNT(*) FROM (SELECT 1 ... LIMIT ?)` against the existing full count then minimum. It can stop at the cap and returns the same capped integer. Uncapped counts still need all eligible matches. Preserve `NOT IN` null handling or use an indexed `NOT EXISTS` with exactly equivalent nonnull pool names. A filter count cache must include pool and domains generations, availability, filters, exclusion and cap. Creating domains invalidates exclude-used counts even if pool data is unchanged.

Use keyset pagination only where a stable total order and index support it. `OFFSET` growth is avoidable; random seed ordering requires storing rank or retaining the ordered cursor. Do not repeatedly recompute and sort random rank for every page.

## Failure handling and remaining risks

The initial cursor transport reuses `reader.chunks()`, which posts without acknowledgements and stores incoming chunks in an unbounded array. Its observed RSS is not a memory bound. The spool transport avoids that queue. Worker failure currently falls back to synchronous main thread reads. The proposed spool operation must reject visibly instead. SQL simplification does not make synchronous fallback safe.

Staging needs a persisted job or build record to survive process restarts. A batch status alone does not provide leases, retry limits, idempotency or cancellation. The durable worker alternative handles that responsibility. SQL B can run inside that alternative, but can also be adopted separately with its narrower guarantee of reduced work.

The synchronous derive-round, supplement, results and multi-open paths are outside this prototype. `openNextBatchRoundAction` may open 50 rounds without yielding. `planBatch` allocates a sizes array proportional to the number of rounds, including extra remainder rounds. These remain potential liveness or allocation problems and need shared limits if the app promises responsiveness across all large operations.

Small row chunks do not impose a hard time limit on a synchronous SQLite write. The measured 250-row transaction can still last hundreds of milliseconds, and the 5000ms busy timeout could block the main loop behind an unrelated writer. This workload does not prove behavior under arbitrary writer lock holds or slow storage. Any promise below that timeout needs a separate contention case and an explicit asynchronous retry policy, rather than a deadline inferred from chunk size.

## Run log

| UTC | Command or action | Result and decision |
| --- | --- | --- |
| 2026-10-28 14:48 to 14:52 | Read AGENTS, diagnosis and acceptance case skills; inspect batch, fill, reader, pool and schema paths | Build one real-module differential loop. No production edits. |
| 2026-10-28 14:50 | Read-only Python inventory and Node native binding check | v14 replica matches current migration head; 2.47M pool rows; Node SQLite 3.53.4. |
| 2026-10-28 14:52 | `node --check tools/perf/sql/bench.mjs` | Exit 0. Harness ready; heavy timings wait for the shared benchmark slot. |

| 2026-10-28 14:53 | `node tools/perf/sql/bench.mjs --source=<replica> --length=4 --order=name --cap=2000 --variant=sql-first` | Pilot exit 0. 2968ms wall, 53ms maximum timer gap, all integrity checks pass. Pilot stayed below five minutes. |
| 2026-10-28 14:53 to 14:59 | Run `baseline-all`, `sql-all`, three each `baseline-first` and `sql-first` on 5L random cap800000, then one 4L control pair | Full ordered membership hashes agree. SQL selection removes two of three temporary sort B-trees. Materialization remains a measured main thread stall. |
| 2026-10-28 15:01 | Single 5L `sql-all --perRound=800000 --materialize=chunked`, queue transport | Exit 0 on integrity, fails timing target. 157.38s, maximum 1477ms gap, observed WAL 1.22GB. Reject cursor during write design. |
| 2026-10-28 15:05 | `node tools/perf/sql/smoke.mjs` | Exit 0. 2005 synthetic rows, 75080 bytes, exact ordered names and original prices retained after editing the source. This crosses the worker's 2000-row and replay's 64 KiB boundaries. |
| 2026-10-28 15:05 | Red-team the transport by omitting its final partial buffer, run smoke, restore worker, run smoke again | Mutant exits 1 with 2000 rather than 2005 rows. Restored worker exits 0. The author of the prototype also authored this check. Its count oracle is a synthetic fixture, while full-scale order parity is characterized against unchanged production code. |
| 2026-10-28 15:06 | `node tools/perf/sql/summarize.mjs --require-responsive` | Exit 1 on the observed baseline-all, SQL-all and cursor giant cases. Without the timing gate, the same command exits 0 after cross-variant digest and independent source count checks. |
| 2026-10-28 15:17 to 15:25 | Three `sql-all --transport=spool --materialize=chunked --chunk=250 --http=true` samples, 4L and 5L at 10000 per round, then 5L at 800000 per round | Each full build preserves membership and passes integrity, HTTP status and drain checks. The 4L control passes responsiveness. Both 5L profiles miss at least one proposed target. No tuning runs followed. |
| 2026-10-28 15:23 | Inspect installed driver defines and read scratch `PRAGMA synchronous` before/after the same WAL setup | Both values are 1, NORMAL. Correct the proposed FULL label before reporting results. No setting was changed. |
| 2026-10-28 15:28 | Resolve owned scratch paths, verify exclusive file handles, remove the disposable DB/WAL/SHM | Removed 1132843008 DB bytes, 8553152 WAL bytes and 32768 SHM bytes, 1141428928 aggregate bytes. This aggregate is not WAL peak. All raw timing JSONs and the source replica are retained. See `cleanup-full-replica.json`. |

## Measured results

All stress samples use the same frozen seed, full replica and filter described above. The first/all comparison is a product tradeoff. The baseline-first versus SQL-first comparison holds membership and immediately created rounds constant. Samples ran serially in an exclusive benchmark slot, with a fresh full copy each time and no application tests running concurrently. Read-worker startup and the independent eligibility count are outside timing. The first baseline-all and first baseline-first samples preceded adding that eligibility preflight. Their independent expected count was checked from later source-identical runs. OS file caches were not flushed.

| Case | Runs | Mean wall seconds | Wall range seconds | Worst timer p95 ms | Maximum gap ms | Peak RSS MiB | Snapshot / domain rows |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 5L baseline, all 80 rounds | 1 | 70.01 | 70.01 | 38.9 | 1540.7 | 154.3 | 800000 / 800000 |
| 5L direct SQL, all 80 rounds | 1 | 61.70 | 61.70 | 283.6 | 1079.6 | 263.5 | 800000 / 800000 |
| 5L baseline, first round | 3 | 26.72 | 25.25 to 29.03 | 16.3 | 531.4 | 174.9 | 800000 / 10000 |
| 5L direct SQL, first round | 3 | 18.49 | 17.99 to 18.78 | 16.3 | 253.3 | 280.8 | 800000 / 10000 |
| 4L baseline, first round | 1 | 2.24 | 2.24 | 16.4 | 458.2 | 129.2 | 120084 / 10000 |
| 4L direct SQL, first round | 1 | 1.93 | 1.93 | 16.4 | 508.9 | 128.5 | 120084 / 10000 |

For the three first-round samples, direct SQL lowers mean wall time by 30.8% and mean process CPU time from 19.78s to 15.35s. It increases observed peak RSS from at most 174.9 MiB to 280.8 MiB because the existing worker chunk protocol can queue many row objects. This is evidence for requiring backpressure, not a bounded-memory result. The all-round SQL-only sample still fails the proposed responsiveness target. No particular long pause is attributed to a checkpoint because no checkpoint trace was collected.

Opening the first round rather than all lowers immediate item inserts from 1600000 to 810000, a 49.4% reduction. Future rounds still need the remaining domain writes. Snapshot storage remains 800000 rows in both cases. All 5L runs share ordered membership SHA256 `d53f3105c9e4f9622ef9a5200f413e9c0c17301bf186344f778d57e6ed0b1a01`; both 4L runs share `6b4820bddf3ae3f810e61db4e719527e249c2bb2fbffb9d8b2ab6c96e660ecda`. Eligible counts before cap are 2338250 at 5L and 120084 at 4L. Every recorded name, price, currency, linkage and position check passed.

These timer gaps measure the Node main loop, with a timer scheduled every 10ms. They are neither HTTP timings nor an SLA guarantee. Peak RSS is sampled by that timer and at completion, so a short allocation peak inside a synchronous call can be missed. CPU user and system times, page growth, observed WAL bytes and full query plans are retained in each raw JSON under `tools/perf/sql/results/`. WAL size is a sampled observation, not total disk write volume. Item row counts quantify write amplification without pretending that every index or checkpoint writes the same number of bytes.

Final spool runs add a separate client thread with a cheap database HTTP ping every 25ms and a vote-shaped insert/count/delete HTTP request every 100ms. They also update an isolated scratch probe row on the main SQLite connection every 25ms, matching the durable worker experiment's writer probe. Every request started during the measured operation is retained through stop and drain. Results include HTTP p95/max, status counts, request errors, equal started/completed counters and unchanged total vote count. They report process high-water RSS as well as sampled RSS. These requests exercise a real database seam without Next routing, authentication or rendered voter pages.

## Implementation acceptance criteria

Before shipping B, verify the following on a restored representative database and then on a local production build.

- Full ordered names match the old selector for all six order modes, identical seeds, null and tied prices/providers, any/all set filters, all availability values, cap boundaries, exclude-used and empty results.
- Snapshot count equals `min(cap, independently counted eligible rows)` when capped. Continuous positions and a digest over every ordered name must match between implementations.
- First/all/extra/last/drop plans conserve the documented placed count. Creating first opens only the first planned round; creating all finishes every planned round. Restriction assignments and no-assignment visibility match current behavior.
- A price or pool edit during batch construction cannot alter frozen membership. A price edit before a future round opens is reflected in that round. One materialization cursor freezes price values while that round is being built. Pool deletion behavior needs an explicit decision because the current join can produce fewer domains than the frozen plan.
- A request ping and representative voter read/write stay below p95 250ms and maximum 1000ms during single 800000-name and 80 by 10000-name builds. Record actual HTTP values as well as event loop gaps. Test with an active long read and writer contention.
- Enforce one bounded input chunk in flight per build, a bounded number of concurrent builds and maximum round/plan limits. Measure both SQLite temporary storage and process RSS. Configure a finite busy timeout and a visible retryable failure; never move a failed worker read onto the main thread.
- Inject selection, snapshot write, materialization and publication failures. No partially built round becomes visible to voters. Retrying cannot duplicate positions, rounds or assignments. Restart behavior must be explicit even if B intentionally has no durable automatic resume.

The initial experiment proves reduced query work and checks output parity for the measured inputs. It does not prove restart recovery, HTTP responsiveness, restricted assignment behavior, all order modes, bounded queue memory or concurrent edit parity. Final spool samples below add external HTTP evidence at the data seam, while the remaining gates still require implementation work.

## Failed cursor materialization probe

The single 5L seeded-random, 800000-name round with 2000-row cooperative transactions completed with correct membership, prices and counts, but took 157.38s. Timer p95 was 478.6ms, maximum 1477.4ms; the slowest measured write transaction took 1461.3ms. Final observed WAL size was 1223701832 bytes. This variant fails the responsiveness target and must not be presented as the viable B implementation. A read cursor was active while writes ran; the WAL size is observed, while the proportion attributable to that cursor versus other SQLite activity was not isolated in this run.

## Spool transport with concurrent database HTTP load

The final transport uses 250-row transactions and `setImmediate` between chunks. It has one production read worker primed outside measurement, one dedicated spool worker active per query, plus the HTTP client worker. These counts should accompany any cross-experiment RSS comparison. It preserves the main connection's measured settings: 16000 KiB cache, 5000ms busy timeout and an automatic WAL checkpoint threshold of 1000 pages. The installed driver defines `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`; a scratch connection using the same WAL setup reports `synchronous=1`, NORMAL. Neither this prototype nor the application overrides it. No index or schema migration is added to make these samples pass.

The 4L control caps at 800000 and therefore selects all 120084 eligible names, producing 13 rounds of at most 10000. It completed in 12.95s with HTTP ping p95 47.7ms, max 334.9ms; vote-shaped writes p95 45.2ms, max 303.6ms. All 539 measured requests succeeded, all 548 started requests drained, and total votes remained unchanged. The high-water RSS was 181403648 bytes and observed peak WAL was 6254192 bytes. Full membership, positions, prices and counts passed.

The matching 5L, 80 by 10000, create-all sample completed in 156.03s. HTTP ping p95 was 264.0ms, max 711.3ms; vote-shaped writes p95 261.1ms, max 680.4ms. It misses the proposed 250ms p95 target while keeping both maxima below 1000ms. All 6489 measured requests succeeded, all 6497 started requests drained, and votes remained unchanged. High-water RSS was 214675456 bytes, observed peak WAL 6258312 bytes, and the largest spool 16800000 bytes. All 800000 names, all 80 rounds and the full digest matched. The slowest measured 250-row write transaction was 723.7ms. No checkpoint trace was collected, so the cause of that individual pause is not assigned.

The single 800000-name round completed in 273.87s. HTTP ping p95 was 447.7ms, max 1031.6ms; vote-shaped writes p95 447.8ms, max 1031.6ms. It misses both proposed limits. All 11387 measured requests succeeded, all 11395 started requests drained, and votes remained unchanged. High-water RSS was 193437696 bytes, observed peak WAL 8553152 bytes, and largest spool 54293808 bytes. The slowest measured 250-row transaction took 1026.7ms. The full snapshot, one complete round, prices and membership digest passed.

| Final spool profile, one sample each | Wall s | HTTP ping p95 / max ms | HTTP vote p95 / max ms | High-water RSS MiB | Peak observed WAL MiB | Target |
| --- | ---: | --- | --- | ---: | ---: | --- |
| 4L, 120084 names, 13 rounds | 12.95 | 47.7 / 334.9 | 45.2 / 303.6 | 173.0 | 6.0 | Pass |
| 5L, 800000 names, 80 rounds | 156.03 | 264.0 / 711.3 | 261.1 / 680.4 | 204.7 | 6.0 | Fail p95 |
| 5L, 800000 names, 1 round | 273.87 | 447.7 / 1031.6 | 447.8 / 1031.6 | 184.5 | 8.2 | Fail p95 and max |

The giant spool profile holds the round plan constant with the failed cursor probe, but also changes the chunk size and adds concurrent HTTP/counter load. Its WAL falls from an observed 1167.0 MiB to 8.2 MiB, while wall time increases. This is evidence that spooling avoids the large overlap between the source read and bulk writes. It is not an isolated measurement of spooling alone. Transfer buffers are bounded by the implementation; a fixed RSS ceiling is not established by one sample.

The worker alternative has separate matched measurements in its own report. B's 250-row chunks, `setImmediate` yields, 5000ms timeout, driver-default NORMAL synchronization and HTTP/counter workload define this result. Its longer all-round wall time and missed targets must accompany any claim that it improves responsiveness. These numbers do not establish an intrinsic limit of SQLite or of every possible cooperative profile. No additional tuning runs were made after the three planned samples.
