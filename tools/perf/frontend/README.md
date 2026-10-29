# Frontend creation experiment

Research only. No application source is edited. The default server binds loopback and uses no database. The two baseline screens import the unchanged production PoolRoundForm and BatchForm. Esbuild replaces only their server-action imports with local HTTP calls and a serial dispatcher model. This measures real React DOM behavior, not Next Server Action transport, redirect handling, production SQL, or an 800,000-row workload.

F1 is a small form with submission feedback, a synchronous duplicate guard, filter-only counts, debounce, response generation checks, and a bounded result preview. F2 adds a ticket monitor, persisted ticket and unresolved submission, adaptive polling, acknowledged cancellation, reload resume, and same-key recovery after a lost acknowledgement. Its job backend is a timed fixture unless the optional adapter is configured.

## Run from this worktree's root

Install application dependencies with `npm ci`. Install experiment dependencies into ignored scratch storage, leaving package.json and the lockfile alone:

```powershell
npm install --prefix data/perf-frontend/deps --no-save --package-lock=false esbuild@0.28.1 playwright@1.55.0
$env:PERF_ESBUILD_MODULE = (Resolve-Path data/perf-frontend/deps/node_modules/esbuild).Path
$env:PERF_PLAYWRIGHT_MODULE = (Resolve-Path data/perf-frontend/deps/node_modules/playwright).Path
node data/perf-frontend/deps/node_modules/playwright/cli.js install chromium
node tools/perf/frontend/build.mjs
node tools/perf/frontend/run.mjs
node tools/perf/frontend/audit.mjs
```

An installed browser can be used by setting `PERF_CHROMIUM` to its executable path. The recorded run reused esbuild 0.28.1, Playwright 1.55.0, and Chromium 145.0.7632.6 through these environment variables, with no dependency or lockfile changes. Playwright's default installed Chromium may differ; the raw result records the browser version. The scripts require Node 20 or later.

To inspect the UI manually:

```powershell
node tools/perf/frontend/server.mjs
```

Open the loopback address printed by the script. The default port is 4318; override it with `PERF_PORT`. `run.mjs` and `audit.mjs` select an ephemeral port and close the server/browser on exit. `mutant=stale` and `mutant=duplicate` deliberately bypass guards for the audit; neither exists in application code.

## Optional actual SQLite job

After the backend worker experiment is available in the same checkout, configure its adapter. The adapter creates its own synthetic fixture under ignored `data/perf-worker/ui`. It never opens the replica. Its input is fixed at four-letter, 10,000 names. This mode does not test form filters or backend idempotency.

```powershell
$env:PERF_JOB_ADAPTER = (Resolve-Path tools/perf/worker/ui-adapter.mjs).Path
node tools/perf/frontend/integrated.mjs
Remove-Item Env:PERF_JOB_ADAPTER
```

During the separate workstream run, the adapter came from the sibling worker worktree. When both commits are combined, the command above resolves it in one checkout. Keep `PERF_JOB_ADAPTER` unset for `run.mjs` and `audit.mjs`, which assert the fixture contract.

## Evidence

`CASES.md` states the oracles before code. `results/browser.json` records three timing samples per variant and error scenarios. `results/browser-before-coalescing.json` preserves the earlier run before the count queue and submitter fixes; use it only as historical evidence. `results/audit.json` records deliberate red/green mutations and baseline duplicate submission observations. `results/integrated.json` records one real local SQLite job when available. The research report states the remaining guarantees a production backend must provide.

The bundle is written only to ignored `data/perf-frontend/app.js`. No browser binaries, application database, user records, domain samples, tokens, or machine-specific paths belong in git.
