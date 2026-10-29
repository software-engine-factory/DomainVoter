# Local background-creation preview

The preview integrates backend A with frontend F2 into the actual app, based on factory main `8b37129`. It runs only on the local machine. No production server, process or database was tested or changed.

The integration branch is `preview/background-creation-2026-10-29`. It merges the preserved research branch before adding authenticated application routes and forms. Selection uses one ordered query and a sealed file manifest, incorporating the simpler selection and bounded staging work from B. The previous standalone benchmark numbers do not predict this combined application's performance.

## Data and startup

The source is the local backup `D:/K Studio/backups/dvote/2026-10-29_1144-prod-live/voting.db`, rather than the older October 28 replica. Its recorded SHA256 was checked before restoring, and checked unchanged again after the full run.

| Restored source | Count |
| --- | ---: |
| Pool names | 2,468,782 |
| Five-character names | 2,338,250 |
| Domains | 120,584 |
| Rounds | 10 |
| Votes | 425 |
| Views | 27,168 |

The writable working copy is `data/preview-20261029/voting.db`. The original local backup stays unchanged. A separate local preview administrator was added to the copy; original accounts were preserved. Schema migration 15 applies only to this working copy and disposable test databases during this session.

The running endpoint is `http://127.0.0.1:1254`. A signed-in browser can open `/admin/creation-jobs`, `/admin/rounds/batch`, or `/admin/rounds/new`. The local 800,000-name result is batch 8. The account and data are local preview data.

Restart with `npm run dev:preview`. The launcher fixes DATA_DIR to this restored copy and binds to 127.0.0.1, regardless of inherited DATA_DIR. It requires the restore marker, disables the legacy free-name mover, enables two read workers and refuses production mode. Data, session secrets, browser cookies and account credentials are not committed.

## Application behavior

- Pool, batch and explorer forms submit an authenticated creation request and receive an accepted ticket. One active bulk writer is admitted per database. Reusing an owner's request key returns the existing job; changing its input is a conflict.
- A dedicated worker selects and writes. Membership is selected once into a sealed, checksummed file. Transfers and inserts use bounded chunks. Job checkpoints commit with their corresponding rows. No failed job falls back to heavy work on the web thread.
- The monitor shows committed phase counters, explicit unknown-total selection, failure, cancellation acknowledgement and a result link. Reloading an accepted ticket reattaches. Expired worker ownership can be reclaimed through a status request; lease tokens fence stale workers.
- New rounds and batches stay hidden until publication. Assignments, prices, frozen membership and ordering are retained. Cancellation removes only unfinished data owned by the job.
- Count scheduling ignores metadata, debounces filters, accepts only current results and coalesces to one active plus one latest desired count. Creation captures the clicked all/first choice before disabling controls.
- Server limits are three million selected names and 2,000 rounds. The batch calculator checks the round limit before allocating its plan array and disables an oversized creation.

## One full local app run

The real Next development app created 800,000 five-character names in 80 rounds of 10,000. The request used any availability, exclude-used enabled, seeded random ordering and create all. The source already included the separate 10,000-name browser integration result.

During creation, asynchronous clients requested the database-backed dataset version about ten times per second and vote reads about five times per second. A real browser toggled a vote about every four seconds and verified the changed state. Requests were allowed to drain. The final vote was restored to its initial state. This is a different workload and environment from the minimal research HTTP harness, not a matched before/after comparison. It includes Next development overhead and local browser tooling.

| Observation | Result |
| --- | ---: |
| Acceptance response | 310.80 ms |
| Full completion | 537.65 s |
| Dataset HTTP p95 / maximum, 3,300 samples | 172.04 / 1,695.55 ms |
| Vote-read HTTP p95 / maximum, 1,785 samples | 307.96 / 1,931.21 ms |
| Browser vote action p95 / maximum, 121 samples | 1,101.57 / 1,919.85 ms |
| Recorded request errors | 0 |
| Materialized / distinct names | 800,000 / 800,000 |
| Round sizes and positions | 80 rounds, each 10,000 names at positions 1..10,000 |
| Existing votes after restoring the probe vote | 425 |

Frozen membership and materialized ordered names have identical SHA256 `c2c20e20d55a1639f8c1281624629f3f91ed3edefdbfb8d3a1a0f6d407cd6ded`. The data checks passed. The run missed the study's acceptance and responsiveness targets. The longer completion time and latency misses are retained as failures; this is a usable local progress/recovery preview, not a claim that the performance problem is resolved.

The first cold batch page took 38.1 seconds to compute aggregates; a later warm request took 159 ms. Cold filtering and count/query work still need attention. These are individual dev-server observations, not repeated page-load benchmarks.

## Checks

| Command or check | Result |
| --- | --- |
| `node tools/perf/run-existing-tests.mjs` | 33 passed, zero failures/skips. Includes 13 new job checks and the original 20 tests. The original npm test launcher still has its existing Windows file-URL problem. |
| `node node_modules/next/dist/bin/next typegen` and `node node_modules/typescript/bin/tsc --noEmit` | Passed. |
| ESLint over the changed application, worker, test and launcher files | Passed without errors or warnings. |
| Actual browser, 10,000-name job | Double submission sent one creation POST, received a ticket and reattached after reload. No JavaScript errors. |
| Actual browser, count scheduling | Title-only edit: zero count requests. Five rapid filter edits: one count request. |
| Oversized calculator plan | Rejected in 118.3 ms with both creation choices disabled; no huge plan array. |
| Desktop/mobile monitor | Rendered; 390-pixel mobile page had no horizontal overflow or JavaScript errors. |
| Deliberate mutation in a disposable worker copy | Dropping the final partial manifest buffer made the suite exit 1 with a source-conservation failure. The live worker source was never edited. |
| Source backup SHA256 and final row/order checks | Passed. |

Saved machine-readable evidence is in `performance-2026-10-29-preview/`. Screenshots, full local probe scripts, server logs and restore metadata are retained under ignored `data/preview-20261029/`. Browser authentication state stays there and is excluded from the evidence committed to git.

## Remaining boundaries

This is a local dev preview. There was no deployment or production testing. Standalone packaging and worker supervision are not validated. Worker termination recovery was exercised on a small fixture; whole-process crashes and power-loss durability were not tested. Reload recovery starts from an accepted ticket; losing acceptance and then reloading the form is not covered.

The new pipeline covers pool, batch and explorer creation. Existing open-next, CSV, derive and supplement paths retain their previous execution behavior. Arbitrary filter combinations, concurrent pool edits and sustained multi-user traffic are not exhaustively covered. The full-data sample is one run; more tuning and repeated local measurements are required before declaring a latency fix.
