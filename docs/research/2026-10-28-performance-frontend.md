# Two frontend options for large round creation

Study date: 2026-10-28. Application baseline: `0506c5e`. Branch: `research/perf-frontend-2026-10-28`.

Both current forms can look idle while creation runs. Neither renders submission pending state or disables creation while its action runs. Fixing that feedback does not reduce database work. F1 addresses the form behavior with the existing request lifecycle. F2 gives long work an accepted ticket and a resumable monitor, provided the backend owns durable jobs.

No application code changed. The runnable experiment is in [tools/perf/frontend](../../tools/perf/frontend/README.md). No production systems, source replica, keys, or user records were accessed by this frontend workstream.

Consolidation check: the original 600 ms SQLite integration result is retained as `tools/perf/frontend/results/integrated-initial.json`. The main study checkout reran the final combined code successfully: 12.9 ms feedback, 40 ms ticket visibility and 617 ms completed-result visibility, with the same 10,000-row invariants and reload reattachment. The current `integrated.json` records that later run.

## Findings in application source

| Area | Evidence | Implication |
| --- | --- | --- |
| Pool creation | [pool-form.tsx](../../src/app/admin/rounds/new/pool-form.tsx) uses `action={createPoolRoundAction}`. Its transition state belongs only to `countPoolAction`. The last button checks count/error only. | A pending count indicator cannot report creation progress. There is no local submit latch. |
| Batch creation | [batch-form.tsx](../../src/app/admin/rounds/batch/batch-form.tsx) uses `action={createBatchAction}`. Both creation buttons check only `!block`. | The two choices stay active during creation. |
| Count request scope | Both forms attach recounting to form-level `onChange`, with a 250 ms timer. | Title, order, seed, assignee, and batch planning edits can cause unnecessary count actions. Batch mounting also recounts its initial filters. |
| Count backend cost | Pool [countPool](../../src/lib/pool.ts) uses the bounded async count cache/inflight deduplication in [data-cache.ts](../../src/lib/data-cache.ts). Batch [countBlock](../../src/lib/batches.ts) reads `COUNT(*)` directly from the reader. | A repeated pool action may be a cache hit. A repeated batch action still sends count SQL. Frontend request counts are not interchangeable with SQL scan counts. |
| Count result ownership | Each callback assigns count after awaiting the action without checking that its filters still match the form. | Obsolete intermediate results can commit after a new filter is selected. A future parallel GET endpoint would also permit a final out-of-order overwrite unless it checks generation/key. |
| Count errors | Pool displays returned `result.error`; batch only assigns `result.count`. Neither callback catches a rejected action locally. Batch's debounce has no unmount cleanup. | Batch can treat a validation error's count zero as an empty pool. Request failures lack a local retry path. |
| Creation server contract | [pool.ts actions](../../src/lib/actions/pool.ts) and [batches.ts actions](../../src/lib/actions/batches.ts) authenticate, await the whole creation, revalidate, then redirect. | There is no accepted job ID, status route, durable idempotency key, cancellation, or resume contract in these actions. A spinner cannot manufacture these guarantees. |
| Current Next action transport | Installed `next@16.4.3/dist/docs/01-app/02-guides/server-actions.md`, "Sequential dispatch on the client". | Server Actions from one client dispatch serially. Debounce does not remove count work already queued. The baseline fixture models this explicitly. It is not a real Next transport benchmark. |
| Explorer | [AutoSubmitForm](../../src/components/admin/auto-submit-form.tsx) pushes a new URL on select/checkbox/radio/date changes, without transition feedback or coalescing. Text applies on submit. [browsePool](../../src/lib/pool-browse.ts) fetches 50 rows. | Rapid discrete filter changes can start several navigations. Show navigation pending and group changes before pushing. Keep URL state and the 50-row result bound. |
| Voter queries | [hooks.ts](../../src/lib/query/hooks.ts) keys cards by round and canonical view. [VoteBoard](../../src/app/vote/[roundId]/vote-board.tsx) keeps previous data, dims it, disables voting until exact data arrives, and prefetches one next page. | There is already a bounded result design. Preserve it. Cards errors have no explicit retry panel and the prefetch promise has no rejection handler. Fetchers do not consume a query cancellation signal. |
| Cache freshness | [QueryProvider](../../src/components/query-provider.tsx) persists dataset queries for 12 hours and watches the dataset version every five minutes/on focus. [dataset-version.ts](../../src/lib/dataset-version.ts) includes newest round ID. User votes are separate and not persisted. | Do not use the 12-hour dataset policy for job status. After job completion, fetch the new dataset version and invalidate affected lists/cards immediately. A monitor must not wait five minutes for its result to appear. |

## What was measured

Chromium 145, local loopback, production React bundle. The baseline mounts the unchanged actual form components, with only action imports substituted. The action fixture serializes calls to model the installed Next docs. It cannot prove production action queue behavior, redirect handling, or duplicate writes in the deployed app.

F1/F2 use minimal representative controls rather than copied production wizards. The HTTP fixture maps filter 1 to 111 and filter 2 to 222, intentionally delays the first response, delays synchronous creation 1.8 seconds, and runs a four-second job whose symbolic total is 800,000. It does not allocate, scan, sort, or insert 800,000 names. Timing below is browser feedback, not backend throughput.

The variants debounce, allow one active count, and retain only the latest pending filter snapshot. A slow request for filter 1 followed by edits to 2 and 3 sends only 1 and 3, with measured peak count concurrency one. Counts that have already started remain backend work.

The cases were written first in [CASES.md](../../tools/perf/frontend/CASES.md). The reported idle state supplies the feedback oracle; count ownership, bounded rendering, and one submission per mounted form are invariants. The same agent wrote the prototypes and checks. Deliberate negative controls make several checks falsifiable, but this is not an independent production review.

The final raw [browser results](../../tools/perf/frontend/results/browser.json) contain three samples per option, collected after the count coalescing and submitter fixes with the DB timing slot released. The earlier [pre-coalescing run](../../tools/perf/frontend/results/browser-before-coalescing.json) is retained as historical evidence.

| Browser timing | F1, three samples | F2, three samples |
| --- | --- | --- |
| First frame with pending feedback | 13.5 / 12.3 / 13.7 ms, median 13.5 ms | 13.3 / 12.8 / 13.7 ms, median 13.3 ms |
| Result visible / ticket visible | 1,871 / 1,875 / 1,867 ms, after a deliberate 1.8 s fixture delay | 113.6 / 114.2 / 117.7 ms, after a deliberate 35 ms acceptance delay |
| Maximum observed status snapshot age | No status endpoint | 515 / 514 / 516 ms |
| Status requests, including reload reattachment | None | 13 per four-second fixture job |

The short ticket response is a lifecycle difference, not a measured reduction in creation work. F2's fixture still runs for four seconds after acceptance.

| Observation | Current actual form with fixture actions | F1 | F2 |
| --- | --- | --- | --- |
| Submit feedback after 80 ms | Neither form sets `aria-busy`; submit remains enabled | Pending state and both choices disabled | Pending state, then accepted ticket |
| Title-only edit | 1 count request per form | 0 | 0 |
| Five filter changes, 50 ms apart | Source already debounces by 250 ms | 1 request in every sample | 1 request in every sample |
| Two synchronous submissions | 2 queued create calls per baseline form in fixture | 1 request in every sample | 1 request in every sample |
| Obsolete response after an edit | Serial action model | Old response ignored; final count 222 | Old response ignored; final count 222 |
| Reload during accepted job | No job ID in current contract | Cannot resume a lost synchronous request | Same ticket; no new create POST |
| Result rendering | Production vote pages are 20/50/100 cards; explorer is 50 rows | 50 synthetic preview rows before and after paging | Same fixture preview bound |

The serial batch baseline committed obsolete count 111 after filter 2 was selected. The batch loading ellipsis can hide stale values while pending. This does not establish an incorrect final count in the actual serial transport.

Recovery checks pass for count failure plus retry, a rejected synchronous create returning editable controls, unknown synchronous outcome blocking blind replay, failed job status, acknowledged cancellation, and two status 503s followed by recovery. Terminal jobs stop polling. A lost job acknowledgement retains the exact request plus idempotency key through reload and recovers the original ticket through the fixture's same-key replay. That is a backend fixture property, not an existing application guarantee.

The lost-ack fixture accepts the job and returns an unreadable JSON acknowledgement. This makes the unknown-state check deterministic. It does not test production disconnect, timeout, or transport retry behavior.

## F1 specification: guarded existing form

Keep the successful create action's final redirect. Render a child submit-controls component with `useFormStatus`, as the installed Next forms guide documents. Both create choices must disable and an `aria-live` status must render in the first frame after submission. Use a synchronous ref guard for duplicate event dispatch until React pending state commits. Capture form data and the clicked `createMode` before disabling inputs, so disabled controls cannot disappear from the submitted snapshot. Keep the selected filters/title visible until success or a declared rejection. Preserving drafts after server validation requires returning typed validation state through `useActionState`; the current redirects back to the form do not provide that behavior.

Count membership fields only. Pool membership consists of classes, providers, sets, set mode, evidence, price bounds, include-unpriced, length, and availability. Batch adds cap and exclude-used. Title, order, seed, assignees, rounds, per-round size, remainder mode, and create mode do not belong to the count key. Normalize and sort array filters into a canonical key, skip unchanged keys, and debounce by 250 ms. Increment generation immediately on membership edit. Only a result whose key/generation still matches may become current, including its error. Cancel timers on unmount. Either keep Server Actions and coalesce to one active plus one latest desired count, or introduce an authenticated count GET route with cancellation signals and query deduplication. Aborting a browser fetch alone does not cancel SQL already running on the server.

Show the last number explicitly as a previous value while updating. Do not let a stale zero/error disable the final form indefinitely. Disable final submission until the latest count is ready, or make backend validation authoritative and label the count as an estimate. The prototype chooses the first behavior. Render count errors with retry, keeping drafts.

Creation states are idle, submitting, completed/redirecting, rejected, and outcome unknown. A known rejection returns editable controls. A disconnected request has an unknown outcome. Do not offer blind "retry create" until a backend lookup/idempotency contract exists. F1 has no honest percentage, cancellation, background completion promise, reload resume, or browser-independent deduplication. Its copy says creation is running and that the page should stay open.

Choose F1 when the backend operation is acceptably short after the SQL work, and immediate progress detail or reload recovery is not required. It can accompany either backend option. It does not solve CPU saturation.

## F2 specification: accepted ticket and monitor

Use the same count discipline and submission guard. The creation POST must return an accepted ticket after a durable job record commits, before scanning/sorting/inserting the full pool. Navigate to a monitor URL containing only that opaque ticket. Saving a browser pointer is a convenience; the authorized monitor URL and server record are the source of truth.

Required backend contract:

```text
POST /api/creation-jobs
  { requestId, operation, normalizedFilters, title, order, seed,
    planning, assigneeIds, createMode }
  -> 202 { id, statusUrl }
  -> 409 if the same requestId carries a different payload
  -> 429 { retryAfterSeconds } if admission is full

GET /api/creation-jobs/:id
  -> { id, revision, state, phase, processed, total?, updatedAt,
       resultUrl?, safeError?, retryable? }

POST /api/creation-jobs/:id/cancel
  -> cancellation requested, not an immediate claim that work stopped
```

Authenticate and authorize every endpoint. Use the existing React Query client with an owner-and-ticket query key, immediate staleness, and no dataset persistence. Scope ticket storage by authenticated admin identity plus schema version, clear pointers on logout/account change, and never reuse the dataset query persistence policy for jobs. The prototype's browser storage keys are local demo keys and have no account isolation. A production implementation must not copy those keys directly.

Bind request ID to normalized payload hash and owner in one durable transaction. Same-key replay returns the same job/result, including after a lost acceptance response or server restart. Persist the unresolved request ID before POST. If the response is lost, look up by request ID or safely replay the identical payload/key. Do not generate a fresh key on retry. A deliberate new creation gets a new request ID after the previous result is reviewed. Client disabling prevents one local race; only backend idempotency prevents duplicate work across reloads, tabs, retries, and devices.

Report phase from the worker. Use indeterminate progress while total is unknown. Once total is fixed, show processed/total for the current phase. Selecting, staging, writing, cleanup, and publication have different work units, so a single percentage can move backward unless the backend defines a monotonic whole-job measure. Do not invent progress from a timer. Include snapshot age and ignore responses with an older revision. The local sample shares a clock with the server; production should include server time or measure elapsed age since receipt to avoid client clock skew. A result is available only after complete publication; incomplete rounds must stay invisible to voters.

Use authenticated no-store GET polling first. Read persisted job counters or a job cache; a status poll must not count or scan the full result set. The measured prototype uses 250 ms after new progress, doubles on unchanged progress up to 1 second, doubles status-failure delay up to 2 seconds, slows hidden tabs to 2 seconds, and refreshes on visibility return. These intentionally short intervals make the four-second experiment observable. For production start with 1 second active/5 seconds unchanged or hidden, back off errors to 30 seconds with jitter, honor Retry-After, and allow only one status request per ticket at a time. Measure the tradeoff against the required freshness before finalizing it. Stop at completed, failed, or canceled. A terminal snapshot must remain recoverable on refresh.

SSE is an optional transport after a status endpoint exists. It reduces repeated polls and can reduce update latency, but requires reconnect/replay, proxy buffering checks, authorization, and a durable status source anyway. No SSE experiment was run. The tested polling path is sufficient to select a frontend lifecycle; it does not establish the final production polling budget.

Cancellation remains requested until the worker acknowledges a terminal canceled state after cleanup. Surface failed and unknown jobs separately, preserve the ticket, and offer same-job retry only if the backend defines its atomicity. On completion, refresh dataset version/invalidate affected round lists, then enable a result link. Do not automatically jump away while the user is reading failure/progress details.

Choose F2 for minute-long creation, navigation away, reload recovery, or server-controlled cancellation. It depends on the durable worker backend. A monitor over the existing synchronous create action would not provide these guarantees.

## Verification and remaining limits

### Real local worker sample

At 15:03 UTC the browser used F2 against the backend worker experiment's adapter, rather than the timed job fixture. The adapter created its own synthetic four-letter 10,000-row SQLite database and used the actual queue plus writer thread. The source replica was not involved. One create request was sent, the browser reloaded after receiving the ticket, and the monitor reattached to that job.

| Browser or backend observation | One sample |
| --- | --- |
| First frame with pending feedback | 14.1 ms |
| Ticket visible | 40 ms |
| First nonzero server status observed | 337 ms, materializing 5,000 / 10,000 |
| Completed state visible | 600 ms |
| Actual created rows / unique names | 10,000 / 10,000 |
| Actual position bounds | 1 through 10,000 |
| Create requests, including reload | 1 |

The initial status had total zero and rendered indeterminate progress. The completed result came from SQLite row counts, not a timer. The raw [integrated result](../../tools/perf/frontend/results/integrated.json) contains each observed snapshot. `node tools/perf/frontend/integrated.mjs` passed. The DB benchmark slot was released immediately afterward. This is one small correctness sample; it does not predict replica throughput or prove worker restart recovery and backend idempotency.

### Commands and limits

Commands run from the worktree root, with dependency paths supplied through environment variables as documented in the experiment README:

- `node tools/perf/frontend/build.mjs`: builds only ignored scratch output.
- `node tools/perf/frontend/run.mjs`: 18 recorded observations, including three timings per option and explicit baseline requirement failures.
- `node tools/perf/frontend/audit.mjs`: removing the response-generation check displays obsolete 111 before final 222 and makes the stale-result assertion RED; removing the ref latch changes one create to two and makes the duplicate assertion RED. Both unchanged guards are GREEN. It also checks count coalescing, the create-first payload, and indeterminate unknown progress. See [audit.json](../../tools/perf/frontend/results/audit.json).
- `node node_modules/eslint/bin/eslint.js tools/perf/frontend`: passes.
- `node node_modules/typescript/bin/tsc --noEmit`: no prototype diagnostics; standalone worktree fails on three existing generated Next globals, `RouteContext` in the cards/votes routes and `LayoutProps` in the app layout. Generate Next types before the combined branch's typecheck.

All DOM measurements use a local fixture unless explicitly labeled as the real SQLite sample. The demo snapshots have no revision merge and browser pointers have no account isolation; both are production integration gates specified above. No production Next build, actual authenticated app navigation, 800,000-row browser payload, screen-reader session, multi-tab account switch, worker crash, database contention, or distributed idempotency was tested here. Backend workstream measurements decide throughput and consistency claims. The frontend study decides feedback, request scope, result ownership, and monitor behavior.

Decision, 2026-10-28: keep both options available for owner selection. F1 is the smaller form change; F2 is the appropriate contract when work must outlive a request or browser page. Preserve existing bounded voting/explorer rendering in either option.
