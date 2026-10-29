# Local constrained performance run

This harness uses an optimized app image against an offline database copy. Next, the creation worker, SQLite and the database share one Linux container cgroup with hard limits of 1 CPU / 1 GiB or 2 CPU / 2 GiB. The service has one SQLite read worker and loopback-only published ports. Docker memory-plus-swap equals the RAM limit, so extra swap is unavailable. Docker Desktop failed to forward the original internal-network ports; the checked configuration uses the default bridge. The scripts accept only loopback application URLs and browser requests to other hosts are blocked.

Docker Desktop with its Linux engine is required. Start with a verified isolated source copy containing `voting.db`. The source is read-only, must have no `-wal` or `-shm` sidecars, and is SHA checked when copied into a named Linux volume. Never point this at the live database or backup. Keep a fresh `PERF_VOLUME_PREFIX` for each image/cap run because one completed benchmark consumes its volume.

```powershell
$env:PERF_SOURCE_DIR = (Resolve-Path 'data/constrained-seed-20261029').Path
$env:PERF_IMAGE = 'domainvoter-perf:20261029' # or domainvoter-perf-baseline:9e53fae
$env:PERF_VOLUME_PREFIX = 'dv-speed-final-20261029'
$env:COMPOSE_PROJECT_NAME = 'dv-speed-final-20261029'
$env:PERF_BASE_URL = 'http://127.0.0.1:12544'
docker compose -f docker-compose.perf.yml --profile perf-2cpu up -d app-perf-2cpu
node tools/perf/constrained/run.mjs --out=docs/research/constrained-2026-10-29/final-2cpu.json
```

For 1 CPU / 1 GiB choose profile `perf-1cpu`, service `app-perf-1cpu`, and port `12543`. For the baseline use its image name and pass `--baseline`. Optional `--names=200000 --rounds=10` supports a small smoke run; the standard run is 2,000,000 names over 10 rounds of 200,000. Use a separate volume prefix for every run. The runner refuses existing completed volumes and verifies the configured Docker CPU and memory limits before work starts.

On first access, the app initializes its isolated database. `setup.cjs` then creates local-only `local_perfadmin` and `local_perfprobe` accounts, a three-domain open round and one fixture vote, and signs per-user session cookies using a random per-volume `session.secret`. The cookies stay inside the container and runner memory. No production credentials or user votes are used. The setup JSON includes the fixture round, probe user and domain IDs for an external local browser write probe; it contains no secret. The probe should use `local_perfprobe` so the runner's admin fixture vote stays untouched.

The runner checks the fixture vote count and whole-vote database digest before and after creation. It records cold and warm real batch, filtered Explore (alphabetical and seeded-random), and vote-page requests, plus authenticated dataset and vote reads during creation. It posts to the real creation API and polls `/api/creation-jobs/{id}`. Its report includes p50/p95/max latency, wall time, cgroup CPU time and peak memory, database/WAL/temp sizes, exact ordered-name hash, count/range checks, prices/currencies and assignee parity. It writes no cookie or domain names. `verify.cjs` performs complete integrity scans inside the capped container after timing ends.

The runner launches `browser-probe.py` through local Python Playwright while creation is active. It clicks the real vote button, waits for each Next server action, reverses the vote and verifies zero probe votes. The generated fixture account is cleaned before final whole-database vote digest verification. The accompanying browser JSON contains action latency and errors, without cookies. Install local Python Playwright and Chromium before running this harness.

Explore measurements include total streamed-response duration and the time the first real name row reaches the client. Counts and facets can finish after visible rows. The cold label means an application-cache first visit, not a purged host disk cache. `query-cases.mjs` separately measures read-only native SQL inside the capped container, with five samples and exact result hashes. Do not run this beside another benchmark. Preserve the result and volume until parity passes; remove local volumes only after review.

The test launcher `node tools/perf/run-existing-tests.mjs` runs its temporary database in a child process and removes it after all SQLite handles close. Completed full-run volumes should also be removed once their JSON parity evidence is saved. Keep only the volume used by the local preview. Never prune unrelated Docker volumes or the original backup folder.

The retained preview is `domainvoter-local-preview` at `http://localhost:12544`, capped at 2 CPU / 2 GiB with one read worker and the same single active creation job rule. It uses only `dv-speed-final-20261029-perf-data-2cpu`; the offline seed bind is no longer required. Start/stop it with `docker start domainvoter-local-preview` and `docker stop domainvoter-local-preview`. The generated local account is `local_perfadmin` with password `local-preview`. This account exists only in the disposable local database.

`ui-check.py <container> <loopback-url> <output-json>` exercises 50 real Explore rows, price cursor next/previous links, a 390px viewport, votes on a compact 200,000-name round, anonymous denial and an unassigned-round 404. It dismisses the normal first-visit tour through its button. No cookies or domain names are written to the report.

It also checks the voter search/pattern APIs and page 4,000 of a 200,000-name round, using an independent range-count query for parity and a 50 KB response bound. Initial browser navigation is separate from five repeats; server caches may already be warm.

`node tools/perf/constrained/used-never-options.mjs` compares five read-only membership-query shapes against the retained preview. It prints only timings, plans, counts and hashes. These are single samples, and the options remain exploratory.
