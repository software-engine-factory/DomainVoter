# Performance release cutover runbook

Status: prepared 2026-10-30, not executed. Production has not been changed. Each step marked **go** needs K's explicit go.

Release: the `dev` head. All commands below assume `SHA=$(git rev-parse dev)` in the local shell. The image was built at `3d78163` and retagged to that head; every later commit touches only `*.md`, which `.dockerignore` excludes (check: `git diff --name-only 3d78163 dev`). It fast-forwards `main` from `8b37129`, the commit production runs now. Migrations 15 to 18 apply to production schema v14.

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
| Schema | v14, `schema_migrations` 1 to 14, so no collision with 15 to 18. `free_names` is empty, so the legacy mover has nothing to do |
| Host | 6 CPU, 11 GiB RAM, 80 GB free on `/` |
| Other writers | No cron or timer writes DomainVoter. Ops imports run by hand from `~/dvote-import` |

## Rehearsal (local, latest backup)

Source: `D:/K Studio/backups/dvote/2026-10-29_1827-prod-live/voting.db`, sha256 `2556bdb8…`, the same file as `~/dvote-backups/20261029-142700-prod-live` on the host. Run in Docker on a named volume, with the release image, `--cpus=2 --memory=2g`.

| Check | Result |
| --- | --- |
| `migrate.cjs check` before | v14, pending 15 to 18, exit 3 |
| `migrate.cjs apply --quick-check` | exit 0, 31 s wall: migrations 25.4 s, preserved-data hashing 0.5 s each side, `quick_check` 4.0 s `ok` |
| Preserved data | users 16, rounds 10, domains 120,584, votes 691, views 72,545, batch items 120,584, pool 2,468,782; all hashes unchanged |
| Replay | applies nothing, 3 s |
| Database size | 1.15 GB to 1.51 GB |
| Old image `8b37129` on the migrated DB | healthy in 2.3 s; `/`, `/login`, `/vote`, `/admin/explore` 200; no errors logged |
| New image on the migrated DB | healthy in 1.9 s; same pages 200; no errors logged |
| Test suite (Linux builder stage of the image) | 48 pass, 0 fail |

Uncapped on Windows the same migration took 34.8 s. Expected downtime on Contabo A: about 10 s to stop, 30 to 40 s to migrate and check, and about 15 s for Coolify to start the container. **Roughly 1 minute**, plus whatever WAL recovery adds (see below). Unauthenticated pages only; signed-in voting was not exercised against the old image.

## Staging (no production effect, can be done any time before go)

```sh
# 0. Rebuild the ignored bundle if missing, and tag the rehearsed image with the release head
npx -y esbuild@0.28.1 scripts/ops/migrate.ts --bundle --platform=node --format=cjs --alias:@=./src   --external:better-sqlite3 --external:bcryptjs --outfile=ops/release/migrate.cjs
docker tag isawmwwcmnfj28hyo3irrvt0:3d78163607224c790e9c52c4334017833190aa6e isawmwwcmnfj28hyo3irrvt0:$SHA
# 1. Ship the rehearsed image and the scripts to Contabo A (load only, nothing restarts)
docker save isawmwwcmnfj28hyo3irrvt0:$SHA | gzip | ssh contabo 'gunzip | sudo -n docker load'
ssh contabo 'mkdir -p ~/dvote-release'
scp ops/release/migrate.cjs contabo:dvote-release/
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
```

`go` does, in order: preflight, online backup through `~/dvote-import/import-forsale.sh backup` (no downtime), Coolify stop, `migrate.cjs apply --quick-check` in a throwaway container of the new image, Coolify deploy, a wait for `/health` 200, then `migrate.cjs check` on the live volume. Logs go to `~/dvote-release/logs/`.

`migrate.cjs apply` fails unless every preserved table (users, rounds, domains, votes, views, round batches and items, supplements, picks) has the same rows and the same hash over its pre-migration columns, `quick_check` is `ok`, and no migration is left pending.

## If something fails

| Where | What happens | Action |
| --- | --- | --- |
| Preflight or backup | Nothing changed, app still up | Fix and rerun |
| Migration | App stays down. Each migration is its own transaction, so completed ones stay recorded | Read `migrate-*.json`. `CONFIRM=yes cutover.sh reopen-old` starts the previous deployment. The old image boots and serves pages on a migrated database (rehearsed with unauthenticated pages only). Or restore the backup with `import-forsale.sh restore` |
| Deploy reports a rebuild | Downtime grows by the build time, 2 to 4 minutes (the last five Coolify deploys took 117 to 234 s) | Let it finish |
| Deploy fails | Database is migrated, app down | `reopen-old`, check which image is running, then investigate |
| After reopening | New writes exist | Fix forward. Do not restore a backup or roll the image back without reconciling new rounds and votes first (see [the rollout guide](production-rollout.md#6-recovery-rules)) |

## Not covered

- The 4.2 GB WAL could not be rehearsed. The backup has no WAL. Recovery work on first open after stop is unmeasured. The migration's `wal_checkpoint(TRUNCATE)` shrinks it to zero afterwards.
- There is no maintenance page. During the window, Traefik answers with an error for `dvote.kayhan.world`.
- Resource caps (2 CPU / 2 GiB) and `DV_RO_WORKERS=1` from the rollout guide are not applied by the script. Production has no limits today. Set them in Coolify before go if wanted; runtime limits do not force a rebuild.
- The leftover `_bk.db` (1.15 GB, 2026-10-29) in the production volume is not touched.
