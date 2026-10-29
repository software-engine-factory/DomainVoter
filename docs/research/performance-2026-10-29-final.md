# Constrained performance comparison, 2026-10-29

Latest preview: warm median time to 50 visible rows is 249 ms for substring search, 357 ms for positional patterns and 165 ms for price sorting, with the app capped at 2 CPU / 2 GiB. The 2-million-name, 10-round creation took 62.16 seconds at 1 CPU versus the original 102.67 seconds, and 46.426 seconds at 2 CPU. Broad never-used queries and arbitrary seeded-random sorting still take seconds. All benchmarks used isolated local copies of an offline backup; production was unchanged.

| Measure | Original baseline, 1 CPU | Candidate v1, 1 CPU, experimental | Final v2, 1 CPU | Final v2, 2 CPU |
| --- | ---: | ---: | ---: | ---: |
| Create 2,000,000 names, 10 rounds | 102.670 s | 92.993 s | 62.160 s | 46.426 s |
| Creation CPU time | 76.43 s | 81.21 s | 55.10 s | 58.02 s |
| Cgroup memory peak | 564 MiB | 1,073,745,920 B | 1,073,750,016 B | 2,147,491,840 B |
| Node process high-water RSS | 251 MiB | 261 MiB | 254 MiB | 266 MiB |
| Dataset API p95 while creating | 53.2 ms | 107.6 ms | 106.0 ms | 56.1 ms |
| Vote API p95 while creating | 70.8 ms | 111.7 ms | 111.5 ms | 53.3 ms |
| Vote page p95 while creating | 207.4 ms | 526.4 ms | 484.9 ms | 180.9 ms |
| Browser vote action p95 | 305.3 ms | 408.9 ms | 496.7 ms | 274.0 ms |
| Integrity / request errors | Pass / 0 | Pass / 0 | Pass / 0 | Pass / 0 |
| Real Explore visible-results check, 2 CPU | Not measured | Not measured | Not measured | Functional checks pass; initial navigation 0.52 / 0.38 / 0.17 s; warm p95 0.30 / 0.36 / 0.17 s |

The memory figures are different measures. Node RSS is the worker/server process high-water mark. Cgroup peak includes the container's anonymous memory and file cache, so it captures the full app-plus-SQLite resource enclosure. At 1 CPU, v1 peaked 4 KiB above the configured 1 GiB value; final v2 peaked 8 KiB above it. At 2 CPU, final v2 peaked 8 KiB above the 2 GiB value. The 2 CPU final snapshot had about 1,765 MiB file cache and 154 MiB anonymous memory; Node RSS was about 266 MiB. The final runs completed without recorded HTTP or integrity errors, but both touched the configured cgroup memory limit.

## Creation and data parity

All three versions submitted the same real authenticated API request: alphabetical ordering, 2,000,000 names, 10 rounds of 200,000, with concurrent dataset-version, vote-read and isolated browser vote probes. Each completed with 2,000,000 selected names and 2,000,000 round members. The ordered-selection SHA256 matched across versions: `7675d1d12cd3f755ca627ce235df744b57cef6ef5be4440520990baecdfc62cb`. Candidate v1 and final v2 stored zero physical `domains` rows for the batch and exposed 2,000,000 catalog rows; baseline materialized 2,000,000 physical domain rows. All parity verifiers passed, and each run preserved its fixture and whole-database vote digest.

At 1 CPU, v1 improved elapsed time by 9.4% over baseline, but used 6.3% more CPU. Final v2 completed 39.4% faster than baseline and used 27.9% less CPU. It was 33.2% faster than v1. Final v2 at 2 CPU completed in 46.426 seconds, 25.3% faster in wall time than final v2 at 1 CPU, while aggregate CPU time was 5.3% higher. Baseline and v1 have no 2 CPU measurements, so the 2 CPU result is not compared with the 1 CPU baseline as an apples-to-apples gain. Every run used the same alphabetical 2-million-name, 10-round request.

At 1 CPU, final-v2 vote API p95 is 57% higher than baseline, vote-page p95 134% higher, and browser vote-action p95 63% higher. At 2 CPU, final-v2 observed 53.3 ms vote API p95, 180.9 ms vote-page p95 and 274.0 ms browser action p95. Those values are below the 1 CPU baseline and final-v2 1 CPU samples. Sample counts differed: baseline/v1/final-v2 1 CPU/final-v2 2 CPU recorded 458/385/256/205 vote API reads, 224/172/119/100 vote-page reads, and 254/186/106/96 browser vote actions. All actions completed without recorded errors; each disposable browser probe restored its vote. These are one-run measurements, not stable distributions.

For local constrained runs, budget 2 CPU / 2 GiB and keep the SQLite read-worker count at one. In this sample it restored vote responsiveness while creation completed sooner. The cgroup still reached its configured memory limit, so the extra CPU does not remove memory pressure. This recommendation is specific to this workload and local resource profile.

The creation stopwatch starts after the app container has started and the runner has warmed the routes. Migration and index-build work happens during first app access, before the timed creation request. Its duration was not recorded here, so these creation figures do not measure total startup-plus-migration cost.

## Filter and count query timings

These are direct read-only SQLite measurements inside each run's capped container, across five executions per query. The reported p50 uses all five samples; result hashes and result counts match across baseline, v1 and final v2. Storage cache was not purged, so the first sample is not a guaranteed cold-disk measurement.

| Query | Rows/result | Baseline 1 CPU p50 | Candidate v1 1 CPU p50 | Final v2 1 CPU p50 / p95 | Final v2 2 CPU p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Length count | 2,338,250 | 2,752 ms | 2,261 ms | 0.016 / 0.740 ms | 0.018 / 0.287 ms |
| Substring count | 23,288 | 2,402 ms | 2,703 ms | 132.82 / 382.56 ms | 223.33 / 258.49 ms |
| Long substring count | 377 | 3,398 ms | 2,613 ms | 37.11 / 40.24 ms | 59.63 / 94.40 ms |
| Position count | 6,040 | 5,715 ms | 665 ms | 213.05 / 484.81 ms | 175.57 / 229.18 ms |
| Substring page, 50 returned rows | 50 visible | 6,184 ms | 2,460 ms | 70.54 / 76.68 ms | 64.32 / 78.99 ms |
| Position page, 50 returned rows | 50 visible | 5,709 ms | 829 ms | 159.06 / 180.27 ms | 226.63 / 263.09 ms |
| Capped count, 2,000 | 2,000 | 5,222 ms | 1.65 ms | 1.57 / 92.14 ms | 1.77 / 1.78 ms |

The capped count is an explicit count limited to 2,000, not the full 2.3-million-name population. For the two page queries, the SQL returns 50 rows; their measured duration includes scanning and ordering work needed to find those rows. This is not equivalent to a rendered app page.

## Real page request timings

Cold is one first page request, warm is five repeats. Full response p95 is kept separate from the instrumented time to obtain visible rows. The visible-row measure is only present where the harness instrumented it.

| Page request | Baseline 1 CPU cold / warm full response | Candidate v1 1 CPU cold / warm | Final v2 1 CPU cold / warm | Final v2 2 CPU cold / warm | Final v2 visible rows 1 CPU / 2 CPU warm p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Batch page | 19,729 / 101 ms | 19,922 / 78 ms | 29,593 / 105 ms | 41,782 / 264 ms | Not instrumented |
| Alphabetical filtered Explore | 6,493 / 1,977 ms | 7,753 / 3,613 ms | 10,571 / 1,084 ms | 24,701 / 2,184 ms | 1,076 / 2,161 ms |
| Seeded-random filtered Explore | 4,612 / 6,629 ms | 9,713 / 13,540 ms | 17,019 / 8,458 ms | 18,399 / 17,934 ms | 8,455 / 17,930 ms |
| Vote page | 146 / 120 ms | 76 / 47 ms | 122 / 53 ms | 344 / 71 ms | Not instrumented |

Explore route timings include the server-rendered response. A 50-row visible-results time can be substantially shorter than the full Explore response, but does not replace it. Cold filtered Explore responses took 10.57 to 24.70 seconds for alphabetical filters and 17.02 to 18.40 seconds for seeded-random filters. Large filtered pages remain slow, especially seeded-random ordering, whose warm p95 was 8.46 seconds at 1 CPU and 17.93 seconds at 2 CPU. Cold samples are single observations and these small sets of warm samples do not establish stable percentiles. Do not infer that the 2 CPU query timings are uniformly faster: position-page SQL p50 was 226.63 ms at 2 CPU versus 159.06 ms at 1 CPU, likely reflecting run and cache variability.

## Real Explore UI check after migration 18

The latest browser check used the completed 2-million-name compact round on the 2 CPU / 2 GiB container. It measured navigation start to painted rows in the browser, with one initial browser navigation and five warm visits. The server cache was already warm for this rerun, so the first sample is not a cold-server measurement. Each route returned 50 rows. Values below are browser-visible time; warm median and p95 use the five warm samples.

| Explore filter | Initial navigation sample | Warm median | Warm p95 | Previous Python wall sample after projection fix |
| --- | ---: | ---: | ---: | ---: |
| Substring `q=ab`, length 5 | 518.9 ms | 249.1 ms | 295.4 ms | 6,899 ms |
| Positional pattern `_a_b_` | 376.2 ms | 356.5 ms | 363.3 ms | 1,002 ms |
| Price ascending, length 5 | 166.8 ms | 165.0 ms | 172.8 ms | 4,795 ms |

The latest check passed: 50 voter cards rendered, no JavaScript errors, cursor round-trip passed, mobile overflow was 0 px, the disposable vote was restored, unassigned round access returned 404 and anonymous access was denied. The real voter API filter probes on the same 200,000-name round returned 7,217 substring matches at 111.03 ms p50 / 120.62 ms p95, 601 positional-pattern matches at 83.07 / 85.12 ms, and page 4,000 at 7.25 / 7.71 ms. These API timings measure server requests, not the browser render. The prior projection-only sample used Python wall-clock timing and ran before the price index and migration 18. Its values are included as historical context, not a directly comparable browser-clock baseline. In the latest samples, Python wall time remained close to browser time. The former 12-second waits came from the correlated aggregate projection building an automatic covering index over the 2-million-row virtual catalog; the later projection change and migration-18 filter indexes brought this checked UI path below 0.52 seconds on the initial navigation sample and below 0.37 seconds warm p95. The server was already warm, so these are not cold-server figures.

Do not read the 70.54 ms native SQLite `substring_page` p50 above as whole-page performance. That direct SQL query returned 50 rows and omitted the live Explore page's correlated projection. Creation, resource, API concurrency and parity figures above use the unchanged creation worker; the full creation benchmark was not rerun after read-path changes.

## Remaining slow path and query alternatives

The indexed price-order query is fast in a direct SQLite probe: five full-projection executions returning 51 rows took 0.44 to 2.35 ms. The `never used` path remains slow after 2 million names have been assigned: a native 51-row name-only query took 4.763 s, and the full projection took 9.428 s. Arbitrary seeded-random pages also remain slow, as shown in the route timings above. These results show the filter/index work did not make every Explore path fast.

Five read-only `never used` SQL strategies returned the same 51 ordered names and SHA-256 (`e11fcce534313aab88b6f31678cc1e008a5334dc7d0c53eeee8be188ecba5a63`) in single native samples: current `NOT EXISTS` 4.614 s, `NOT IN` over a union 3.725 s, materialized CTE with `NOT IN` 4.177 s, materialized CTE with left join 4.811 s, and `EXCEPT` over a union 3.106 s. The `EXCEPT` query was fastest in this sample, but still took 3.1 seconds and required temporary ordering. No alternative was adopted: these are single observations and none demonstrated a sufficient, well-validated improvement. A materialized membership index may improve this path, but it would add storage and write work that needs a separate resource-budget assessment.
## Implementation and verification

The measured change keeps one SQLite read worker and stores the large selection compactly, with filter indexes and equal-length SQL predicates added for read paths. On branch `perf/indexed-filtering-2026-10-29`, 48 tests passed, TypeScript validation passed and the optimized production build passed. The branch remains local and unpushed. Migration and index-build cost is excluded from the creation stopwatch, as noted above.
## Evidence and limits

Raw files: [baseline creation and routes](constrained-2026-10-29/baseline-1cpu.json), [candidate v1 creation and routes](constrained-2026-10-29/candidate-1cpu.json), [final v2 1 CPU creation and routes](constrained-2026-10-29/final-1cpu.json), [final v2 2 CPU creation and routes](constrained-2026-10-29/final-2cpu.json), [baseline SQL queries](constrained-2026-10-29/baseline-1cpu-queries.json), [candidate v1 SQL queries](constrained-2026-10-29/candidate-1cpu-queries.json), [final v2 1 CPU SQL queries](constrained-2026-10-29/final-1cpu-queries.json), [final v2 2 CPU SQL queries](constrained-2026-10-29/final-2cpu-queries.json), [baseline browser votes](constrained-2026-10-29/baseline-1cpu-browser.json), [candidate v1 browser votes](constrained-2026-10-29/candidate-1cpu-browser.json), [final v2 1 CPU browser votes](constrained-2026-10-29/final-1cpu-browser.json), [final v2 2 CPU browser votes](constrained-2026-10-29/final-2cpu-browser.json), [UI before projection fix](constrained-2026-10-29/final-ui-before-projection-fix.json), [UI after migration 18](constrained-2026-10-29/final-ui-check.json), [UI after projection only, before price index](constrained-2026-10-29/ui-after-projection-before-price-index.json), [price projection and never-used probes](constrained-2026-10-29/projection-after-price-index.json), [never-used query strategies](constrained-2026-10-29/used-never-strategies.json).

This is one full run per image and cap. It does not establish a stable performance distribution. The post-fix UI check reused the completed 2 CPU database and measured only read paths; creation was not rerun. The randomized and page query samples also depend on host cache state.


## Final verification and cleanup

Source commit `990e086` is local on `perf/indexed-filtering-2026-10-29`. `node tools/perf/run-existing-tests.mjs` passed 48/48, `npx tsc --noEmit` passed, and the optimized Docker build passed. The latest browser check also verified ordinary username/password login at `http://localhost:12544`. `PRAGMA quick_check` returned `ok`, `foreign_key_check` returned no rows, summary totals matched all 2,468,782 pool records, and the whole-database vote digest was unchanged after browser QA. See [final verification](constrained-2026-10-29/final-integrity-and-cleanup.json).

Only `dv-speed-final-20261029-perf-data-2cpu` remains for the local preview. Completed baseline/candidate/1-CPU volumes, the old Windows preview, isolated seed copy, temporary test databases and four clean research worktrees were removed. Research branches and all original backups were preserved. The original backup SHA256 was rechecked and still matches `dbdf047a0906dbc941aca393357fe1a385bc5aacf869f3b38af052a8396b06b1`. D: had about 49.2 GiB free at the final observation. No global Docker prune or unrelated project cleanup was performed.
