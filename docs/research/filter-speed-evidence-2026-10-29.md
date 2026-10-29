# Filtering speed evidence and next comparison

All measurements below use the local preview copy. No production requests, migrations or application changes were made in this investigation. Engine options and primary-source references are in [filtering engine options](filtering-engine-options-2026-10-29.md).

## What can be faster already

The pool has 2,468,782 records, including 2,338,250 five-character names. Read-only Python SQLite 3.50.4 probes ran serially on this PC. They measure raw SQL, not the application, its native SQLite version, or the smaller server. Samples are warm and few. The JSON files contain all timings and query-plan summaries.

| Operation | Existing approach | Candidate approach | Correctness checked |
| --- | --- | --- | --- |
| Alphabetical page after 1,000,000 matching names | OFFSET: 217.580, 224.238, 227.935 ms | Indexed name cursor: 0.027, 0.034, 0.157 ms | Exactly the same 50 names in the same order. The cursor boundary was obtained outside timing. |
| Five-character count with a 2,000-item cap | Count 2,338,250 then apply cap: 1,730.665, 1,809.908 ms | Count a subquery limited to 2,000: 0.945, 1.471 ms | Both give the capped answer 2,000. The limited query does not give the full total. |
| Exact five-character substring count for `%ab%` | 1,911.520, 2,020.591 ms | No indexed replacement measured | 23,288 matches. |
| Exact five-character positional count for `_a_b_%` | 1,794.710, 1,951.451 ms | No indexed replacement measured | 6,040 matches. |

The first 50 names without a count took 0.042 and 0.140 ms. This query selected names only, without the application's rich row subqueries. `browsePool` currently awaits an exact count before fetching the page. Removing that dependency and caching or preaggregating counts addresses a separate cost from fetching visible rows. Indexed cursor pagination avoids discarding increasingly many preceding rows. See [SQLite scrolling windows](https://www.sqlite.org/rowvalue.html#scrolling_window_queries).

Raw evidence: [query probes](filter-speed-2026-10-29/read-probes.json), [same-page cursor comparison](filter-speed-2026-10-29/cursor-parity.json).

## Where creation time went

Saved status observations from the [actual preview run](performance-2026-10-29-preview/full-job-result.json) put selection at approximately 61 seconds, staging at 13 seconds, and materialization at 463 seconds, out of 537.65 seconds total. These are approximate phase boundaries inferred from polling, not internal profiler spans. Materialization accounts for about 86% of elapsed time.

The implementation stores frozen batch membership and then inserts full domain rows for rounds. Thus 800,000 names require roughly 1.6 million application-row insertions, before index maintenance. Two million names split among ten reviewers still require processing two million names, or 200,000 per reviewer. Reducing 80 rounds to ten does not reduce per-name work eightfold.

The local `domains` table has eight indexes. `domains_round_name_idx(round_id,name)` duplicates the column list of the unique `(round_id,name)` autoindex. Review plans and measure a local removal before treating it as safe. Fewer indexes can reduce insert work, but this alone does not remove duplicated domain data.

The larger proposed change is one immutable ordered selection of compact pool IDs, with reviewer assignments stored as ranges. Fetch display fields for the visible page. Preserve historical prices, source version, exclude-used rules, assignment access and arbitrary-seed ordering. Membership still has an O(N) creation cost unless an immutable source and order permit a range-only representation. No speedup for this redesign has been measured.

## Next local comparison

Compare an optimized SQLite implementation and a PostgreSQL prototype against identical filters, orders and selections. Fix query work and copying in both; changing engines alone is not a fair comparison. For position filters, test indexed character columns or matching expression indexes. Test trigram indexes for longer substrings, but explicitly include one- and two-character searches that trigram indexing cannot generally accelerate.

Keep one admitted creation job per database. Migration 15 already enforces this with a unique active-job index and the worker uses a durable lease. This is admission control, not a hard CPU, RAM or disk limit. Also bound read concurrency, temporary bytes, transaction duration and the creation worker's duty cycle. Reject another creation while busy or use a bounded queue.

Use a local optimized application build within the target server's CPU, memory and storage budget. That hardware budget is still unknown. CPU limits alone do not reproduce slower storage. Measure cold and warm page/count p50 and p95, creation phase times, peak memory, database/WAL/temp growth and vote latency while one creation runs. Check exact result parity and stable pagination. Proposed goals of page p95 below 100 ms and visible filter response below 200 ms remain goals, not measured server results.
