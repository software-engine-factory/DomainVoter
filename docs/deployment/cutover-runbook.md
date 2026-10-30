# Performance release cutover runbook

Status: prepared 2026-10-30, not executed. Production has not been changed. Each step marked **go** needs K's explicit go.

Release: the `dev` head. All commands below assume `SHA=$(git rev-parse dev)` in the local shell. The image was built at `d73b339` (performance release plus the name-screening collections, pool sets 6 to 8, and the voter progress bars) and is retagged to that head; later commits touch only `docs/` and `ops/release/`, which do not reach the runtime stage of the image (`git diff --name-only d73b339 dev` lists them). It fast-forwards `main` from `8b37129`, the commit production runs now. Migrations 15 to 19 apply to production schema v14.

## How downtime stays short

- The release image is built and rehearsed in advance, then loaded on Contabo A as `isawmwwcmnfj28hyo3irrvt0:$SHA`. Coolify skips the build when an image tagged with the deployed commit SHA already exists ("Image found ... Build step skipped"). The cutover is then a container swap, not a 2 to 4 minute build.
- Coolify auto-deploy is turned off before `main` is pushed, so the push itself deploys nothing. The deploy is started by the script, after the migration has run.
- The old app is stopped before the migration starts, so two versions never write the SQLite volume at the same time.
- Downtime runs from stopping the app until the new container is healthy. The rehearsal below measures it.

## Production facts (read-only, 2026-10-30)

| Item | Value |
| --- | --- |
| Coolify app | `isawmwwcmnfj28hyo3irrvt0` (`domainvoter`), `https://dvote.kayhan.world`, Dockerfile build pack |
| Watched branch | `software-engine-factory/DomainVoter` `main`, auto-deploy **on**, no branch protection |
| Running | `isawmwwcmnfj28hyo3irrvt0:8b3712971cd8…`, image `sha256:5a0310c1…`, healthy |
| Coolify health check | off. No CPU or memory limits set |
| Volume | `isawmwwcmnfj28hyo3irrvt0-dvote-data` at `/app/data`: `voting.db` 1.15 GB, `voting.db-wal` 4.2 GB, `session.secret`, `forsale/` |
| Schema | v14, `schema_migrations` 1 to 14, so no collision with 15 to 19. `free_names` is empty, so the legacy mover has nothing to do |
| Host | 6 CPU, 11 GiB RAM, 80 GB free on `/` |
| Other writers | No cron or timer writes DomainVoter. Ops imports run by hand from `~/dvote-import` |

## Rehearsal (local, latest backup)

Source: `D:/K Studio/backups/dvote/2026-10-29_1827-prod-live/voting.db`, sha256 `2556bdb8…`, the same file as `~/dvote-backups/20261029-142700-prod-live` on the host. Run in Docker on a named volume, with the release image, `--cpus=2 --memory=2g`.

| Check | Result |
| --- | --- |
| `migrate.cjs check` before | v14, pending 15 to 19, exit 3 |
| Release `d73b339`, `--cpus=2 --memory=2g` (2026-10-30) | `migrate.cjs apply --quick-check` 30.0 s (migrations 25.5 s, `quick_check` 2.9 s `ok`, data preserved); `screen-apply.cjs` 24.8 s, 2,338,250 names: 566,120 prefiltered, 1,770,404 rejected, 1,726 banned, 0 not in pool; replay 10.6 s, changes nothing; healthy in 1.8 s, `/`, `/login`, `/vote`, `/admin/explore`, `/admin/rounds/new` 200; old image `8b37129` on the v19 database healthy in 1.6 s, same pages 200. Signed in: admin round form shows the three collections with counts, voter list shows own progress, a vote with the server stopped shows the Persian "server unreachable" message. At `--cpus=4` the two steps take the same time (SQLite uses one core). 53 tests pass |
| `migrate.cjs apply --quick-check` | exit 0, 31 s wall: migrations 25.4 s, preserved-data hashing 0.5 s each side, `quick_check` 4.0 s `ok` |
| Preserved data | users 16, rounds 10, domains 120,584, votes 691, views 72,545, batch items 120,584, pool 2,468,782; all hashes unchanged |
| Replay | applies nothing, 3 s |
| Database size | 1.15 GB to 1.51 GB |
| Old image `8b37129` on the migrated DB | healthy in 2.3 s; `/`, `/login`, `/vote`, `/admin/explore` 200; no errors logged |
| New image on the migrated DB | healthy in 1.9 s; same pages 200; no errors logged |
| Test suite (Linux builder stage of the image) | 48 pass, 0 fail |

Expected downtime on Contabo A for `d73b339`, from the measured steps: about 10 s to stop, 10 to 30 s for the final backup, 30 to 45 s to migrate and check, 25 to 40 s for the screening sets, about 15 s for Coolify to start the container. **Measured on the server 2026-10-30: migrate 86 s, screening 63 s, online backup with the 4.2 GB WAL 163 s. Expect about 4 to 6 minutes with SCREEN_AFTER=1, 5 to 7 without** (the rehearsal-PC figure of 1.5 to 2.5 minutes was too low), plus whatever folding the 4.2 GB WAL adds (unmeasured, see below). The upper ends allow for Contabo's cores being slower than the rehearsal PC. Running the screening after reopening (`cutover.sh screen`) instead would take 25 to 40 s off the window.

## Staging (no production effect, can be done any time before go)

```sh
# 0. Rebuild the ignored bundle if missing, and tag the rehearsed image with the release head
npx -y esbuild@0.28.1 scripts/ops/migrate.ts --bundle --platform=node --format=cjs --alias:@=./src   --external:better-sqlite3 --external:bcryptjs --outfile=ops/release/migrate.cjs
npx -y esbuild@0.28.1 scripts/ops/screen-apply.ts --bundle --platform=node --format=cjs --external:better-sqlite3 --outfile=ops/release/screen-apply.cjs
bun scripts/screen/export-categories.ts   # ops/release/screen-categories.tsv.gz, needs research/name-screening/out/open (see its README)
docker tag isawmwwcmnfj28hyo3irrvt0:d73b3391b9e2b14f2feebd3c388f76eb81202c20 isawmwwcmnfj28hyo3irrvt0:$SHA
# 1. Ship the rehearsed image and the scripts to Contabo A (load only, nothing restarts)
docker save isawmwwcmnfj28hyo3irrvt0:$SHA | gzip | ssh contabo 'gunzip | sudo -n docker load'
ssh contabo 'mkdir -p ~/dvote-release'
scp ops/release/migrate.cjs ops/release/screen-apply.cjs ops/release/screen-categories.tsv.gz contabo:dvote-release/
git show $SHA:ops/release/cutover.sh | ssh contabo 'cat > ~/dvote-release/cutover.sh && chmod +x ~/dvote-release/cutover.sh'
# 2. Read-only preflight
ssh contabo "~/dvote-release/cutover.sh preflight $SHA"
```

## Go (K says go)

Avoid the minutes when people are actively voting if possible. Nobody should be running an import.

```sh
ssh contabo 'CONFIRM=yes ~/dvote-release/cutover.sh autodeploy off'   # go: Coolify setting
git push factory $SHA:main                                    # go: shared branch, fast-forward, deploys nothing
ssh contabo "CONFIRM=yes ~/dvote-release/cutover.sh go $SHA"  # go: online backup, then the downtime window
ssh contabo 'CONFIRM=yes ~/dvote-release/cutover.sh autodeploy on'   # restore the previous setting
ops/release/fetch-backup.sh   # on the PC: copies the newest ~/dvote-backups/* into .backups/ (git-ignored) and checks sha256
```

`go` does, in order: preflight, Coolify stop, a final backup of the stopped database, `migrate.cjs apply --quick-check` in a throwaway container of the new image, `screen-apply.cjs` (fills the new collections, pool sets 6 to 8), Coolify deploy, a wait for `/health` 200, then `migrate.cjs check` on the live volume. Logs go to `~/dvote-release/logs/`.

The throwaway migration and screening containers run with `--cpus=4`, 70% of the host's 6 cores (`CPUS=` overrides). They exit when done, so no limit stays on the host; the app container keeps its current settings (no limits). If the screening step fails, the release continues with empty collections and `CONFIRM=yes cutover.sh screen $SHA` reapplies them later; it only writes pool.set_6..set_8 and is safe to repeat while the app is up.

The migration's `wal_checkpoint(TRUNCATE)` folds the 4.2 GB `voting.db-wal` into the database and shrinks the file to zero. It holds committed writes, not a history, so nothing is lost; the backup taken just before already contains them.

The backup is taken after the stop, so it holds every committed vote, including writes still in the WAL (tested with a database left by a killed process). It runs `sqlite3 .backup` as the volume owner, then `quick_check`, sha256 and row counts, into `~/dvote-backups/<ts>-pre-perf-release/` in the layout `import-forsale.sh restore` expects. Locally this took 11 s for the 1.15 GB database. If it fails, the script starts the old app again before anything is migrated.

`migrate.cjs apply` fails unless every preserved table (users, rounds, domains, votes, views, round batches and items, supplements, picks) has the same rows and the same hash over its pre-migration columns, `quick_check` is `ok`, and no migration is left pending.

## If something fails

| Where | What happens | Action |
| --- | --- | --- |
| Preflight | Nothing changed, app still up | Fix and rerun |
| Final backup | App was stopped, nothing migrated. The script reopens the old app | Fix and rerun |
| Migration | App stays down. Each migration is its own transaction, so completed ones stay recorded | Read `migrate-*.json`. `CONFIRM=yes cutover.sh reopen-old` starts the previous deployment. The old image boots and serves pages on a migrated database (rehearsed with unauthenticated pages only). Or restore the backup with `import-forsale.sh restore` |
| Deploy reports a rebuild | Downtime grows by the build time, 2 to 4 minutes (the last five Coolify deploys took 117 to 234 s) | Let it finish |
| Deploy fails | Database is migrated, app down | `reopen-old`, check which image is running, then investigate |
| After reopening | New writes exist | Fix forward. Do not restore a backup or roll the image back without reconciling new rounds and votes first (see [the rollout guide](production-rollout.md#6-recovery-rules)) |

## Not covered

- The 4.2 GB WAL could not be rehearsed. The backup has no WAL. Recovery work on first open after stop is unmeasured. The migration's `wal_checkpoint(TRUNCATE)` shrinks it to zero afterwards.
- There is no maintenance page. During the window, Traefik answers with an error for `dvote.kayhan.world`.
- Resource caps (2 CPU / 2 GiB) and `DV_RO_WORKERS=1` from the rollout guide are not applied by the script. Production has no limits today. Set them in Coolify before go if wanted; runtime limits do not force a rebuild.
- Do not delete or copy around `voting.db-wal` by hand. It holds committed writes; only the SQLite backup and the migration handle it correctly.
- After reopening, rounds created by the new version use compact storage the old image cannot read. Holding off on new rounds for the first day keeps a rollback cheap.
- The leftover `_bk.db` (1.15 GB, 2026-10-29) in the production volume is not touched.
