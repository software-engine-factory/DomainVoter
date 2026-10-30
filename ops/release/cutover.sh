#!/usr/bin/env bash
# Performance release cutover on Contabo A (Coolify app isawmwwcmnfj28hyo3irrvt0). Runbook: docs/deployment/cutover-runbook.md
#   cutover.sh preflight SHA                 read-only: running app, prebuilt image, Coolify settings, disk, other writers
#   CONFIRM=yes cutover.sh autodeploy on|off  Coolify "auto deploy on push" (off before pushing main, on again after)
#   CONFIRM=yes cutover.sh go SHA            stop -> final backup -> migrate (new image) -> screening sets -> deploy prebuilt image -> verify
#                                            SCREEN_AFTER=1 skips the screening sets in the window; run `screen` after reopening
#   CONFIRM=yes cutover.sh screen SHA        (re)apply the name-screening sets 6-8 only; safe to repeat, app may be up
#   cutover.sh backup SHA                    online backup now (app keeps running) -> ~/dvote-backups/<ts>-pre-go-online
#   CONFIRM=yes cutover.sh reopen-old        migration failed: start the previous deployment again (DB is compatible)
# Never runs two app versions on the volume at once. Downtime = stop .. new container healthy.
set -euo pipefail
APP=isawmwwcmnfj28hyo3irrvt0
HERE=$HOME/dvote-release
VOL=/var/lib/docker/volumes/$APP-dvote-data/_data
URL=https://dvote.kayhan.world
API=http://localhost:8000/api/v1
LOG=$HERE/logs; mkdir -p "$LOG"
TS=$(date +%Y%m%d-%H%M%S)
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG/cutover-$TS.log" >&2; }
need_confirm() { [ "${CONFIRM:-}" = yes ] || { echo "refusing: live step needs CONFIRM=yes" >&2; exit 1; }; }
api() { local T; T=$(tr -d '\r\n' < ~/.coolify-dvote-token); curl -s -H "Authorization: Bearer $T" -H 'Content-Type: application/json' "$@"; }
container() { sudo -n docker ps --filter "name=$APP" --format '{{.Names}}' | head -1; }
health() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/health" || true; }
autodeploy_state() { api "$API/applications/$APP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["settings"]["is_auto_deploy_enabled"])'; }
# Same throwaway-container pattern as ops/import-forsale: the NEW image's node + better-sqlite3, app uid, no network.
# Release tools may use up to 70% of the host's cores (4 of 6); the containers exit after, so nothing stays capped.
CPUS=${CPUS:-4}
migrate() { sudo -n docker run --rm --network none --cpus="$CPUS" -u "$(sudo -n stat -c %u:%g "$VOL/voting.db")" -e NODE_PATH=/app/node_modules -v "$VOL:/app/data" \
  -v "$HERE/migrate.cjs:/tool/migrate.cjs:ro" --entrypoint node "$APP:$SHA" /tool/migrate.cjs "$@" --db /app/data/voting.db; }
# Name-screening collections (pool.set_6..8, migration 19). Data only; failure does not block the release.
screen_apply() { sudo -n docker run --rm --network none --cpus="$CPUS" -u "$(sudo -n stat -c %u:%g "$VOL/voting.db")" -e NODE_PATH=/app/node_modules -v "$VOL:/app/data" \
  -v "$HERE/screen-apply.cjs:/tool/screen-apply.cjs:ro" -v "$HERE/screen-categories.tsv.gz:/tool/screen-categories.tsv.gz:ro" \
  --entrypoint node "$APP:$SHA" /tool/screen-apply.cjs --db /app/data/voting.db --file /tool/screen-categories.tsv.gz "$@"; }

# Backup with VACUUM INTO, run in a throwaway container of the release image as the volume owner (the SSH user
# cannot traverse /var/lib/docker, so host sqlite3 cannot open the volume). VACUUM INTO reads one consistent snapshot,
# WAL included, so it is safe while the app runs; with the app stopped it holds every committed vote.
#   backup_db <label>   -> ~/dvote-backups/<ts>-<label>/{voting.db,voting.db.sha256,meta.json}
backup_db() {
  local out=$HOME/dvote-backups/$TS-$1; mkdir -p "$out"; chmod 700 "$out"
  sudo -n docker run --rm --network none -u "$(sudo -n stat -c %u:%g "$VOL/voting.db")" -e NODE_PATH=/app/node_modules -v "$VOL:/app/data" -v "$out:/backup" \
    --entrypoint node "$APP:$SHA" -e 'const D=require("better-sqlite3"),db=new D("/app/data/voting.db"),q=String.fromCharCode(39);db.pragma("busy_timeout = 10000");db.exec("VACUUM INTO "+q+"/backup/voting.db"+q);db.close()' || return 1
  [ "$(sqlite3 -readonly "$out/voting.db" 'pragma quick_check')" = ok ] || { say "backup quick_check failed"; return 1; }
  (cd "$out" && sha256sum voting.db > voting.db.sha256)
  sqlite3 -readonly "$out/voting.db" "select json_object('user_version',(select max(version) from schema_migrations),'users',(select count(*) from users),'rounds',(select count(*) from rounds),'domains',(select count(*) from domains),'votes',(select count(*) from votes),'views',(select count(*) from views),'pool',(select count(*) from pool))" > "$out/meta.json"
  chmod 600 "$out"/*; say "backup $out $(cat "$out/meta.json") sha256=$(cut -c1-16 "$out/voting.db.sha256")"
}
backup_stopped() { backup_db pre-perf-release; }

preflight() {
  local ok=1 c img
  c=$(container); [ -n "$c" ] || { say "FAIL app container not running"; ok=0; }
  [ -n "$c" ] && { img=$(sudo -n docker inspect -f '{{.Config.Image}}' "$c"); say "running $c image $img health $(health)"; }
  [ -n "$c" ] && [ "$img" = "$APP:$SHA" ] && { say "FAIL release image is already running"; ok=0; }
  sudo -n docker image inspect "$APP:$SHA" >/dev/null 2>&1 && say "release image $APP:$SHA present" || { say "FAIL release image $APP:$SHA not loaded"; ok=0; }
  [ -f "$HERE/migrate.cjs" ] && say "migrate.cjs $(sha256sum "$HERE/migrate.cjs" | cut -c1-16)" || { say "FAIL $HERE/migrate.cjs missing"; ok=0; }
  for f in screen-apply.cjs screen-categories.tsv.gz; do [ -f "$HERE/$f" ] && say "$f $(sha256sum "$HERE/$f" | cut -c1-16)" || { say "FAIL $HERE/$f missing"; ok=0; }; done
  say "coolify auto-deploy $(autodeploy_state)"
  say "volume $(sudo -n du -sh "$VOL" | cut -f1), free on / $(df -h / | awk 'NR==2{print $4}')"
  local w; w=$(pgrep -af 'import-forsale|migrate.cjs' | grep -v pgrep || true)
  [ -z "$w" ] && say "no ops writers running" || { say "FAIL ops writer running: $w"; ok=0; }
  [ "$ok" = 1 ] || exit 1
}

case "${1:-}" in
  preflight) SHA=${2:?SHA}; preflight;;
  autodeploy) need_confirm; v=${2:?on|off}; [ "$v" = on ] && b=true || b=false
    api -X PATCH "$API/applications/$APP" -d "{\"is_auto_deploy_enabled\":$b}" -o /dev/null -w "patch %{http_code}\n"
    say "coolify auto-deploy now $(autodeploy_state)";;
  go) need_confirm; SHA=${2:?SHA}; preflight
    [ "$(autodeploy_state)" = False ] || { say "FAIL turn auto-deploy off first, then push main"; exit 1; }
    T0=$(date +%s); say "DOWNTIME START: stopping app"
    api -X POST "$API/applications/$APP/stop" -o /dev/null -w "stop %{http_code}\n"
    for i in $(seq 1 60); do [ -z "$(container)" ] && break; sleep 1; done
    [ -z "$(container)" ] || { say "FAIL app did not stop; starting nothing, investigate"; exit 1; }
    say "stopped after $(( $(date +%s) - T0 ))s; final backup"
    backup_stopped || { say "FAIL backup; nothing migrated, reopening the old app"; "$0" reopen-old; exit 1; }
    say "backed up after $(( $(date +%s) - T0 ))s; migrating"
    if ! migrate apply --quick-check | tee "$LOG/migrate-$TS.json"; then
      say "FAIL migration (see $LOG/migrate-$TS.json). App is DOWN. Decide: CONFIRM=yes $0 reopen-old, or restore the backup"; exit 1
    fi
    if [ "${SCREEN_AFTER:-}" = 1 ]; then say "migrated after $(( $(date +%s) - T0 ))s; screening sets deferred until after reopen (SCREEN_AFTER=1)"
    else say "migrated after $(( $(date +%s) - T0 ))s; applying screening sets"
      screen_apply > "$LOG/screen-$TS.json" && say "screening sets $(cat "$LOG/screen-$TS.json")" || say "WARN screening sets failed (see $LOG/screen-$TS.json); release continues, rerun: CONFIRM=yes $0 screen $SHA"; fi
    say "screening done after $(( $(date +%s) - T0 ))s; deploying prebuilt $APP:$SHA"
    # Coolify 4.4.7 refuses GET on some action routes (stop answered 405); try GET, then POST.
    dep_uuid() { python3 -c 'import json,sys; print(json.load(sys.stdin)["deployments"][0]["deployment_uuid"])' 2>/dev/null; }
    D=$(api "$API/deploy?uuid=$APP&force=false" | dep_uuid) || D=$(api -X POST "$API/deploy?uuid=$APP&force=false" | dep_uuid) || { say "FAIL could not start the deployment; DB is migrated. Deploy from the Coolify UI, or: CONFIRM=yes $0 reopen-old"; exit 1; }
    say "deployment $D"
    for i in $(seq 1 180); do
      st=$(api "$API/deployments/$D" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))'); [ "$st" = finished ] || [ "$st" = failed ] && break; sleep 2
    done
    api "$API/deployments/$D" | python3 -c 'import json,sys; [print(l.get("output","")) for l in json.loads(json.load(sys.stdin).get("logs") or "[]") if not l.get("hidden")]' > "$LOG/deploy-$TS.log" || true
    grep -q 'Build step skipped' "$LOG/deploy-$TS.log" && say "coolify reused the prebuilt image" || say "WARN coolify did not report a skipped build (see $LOG/deploy-$TS.log)"
    [ "$st" = finished ] || { say "FAIL deployment status '$st'. DB is migrated; old image is compatible: CONFIRM=yes $0 reopen-old"; exit 1; }
    for i in $(seq 1 60); do h=$(health); [ "$h" = 200 ] && break; sleep 1; done
    say "DOWNTIME END after $(( $(date +%s) - T0 ))s: health $h, running $(sudo -n docker inspect -f '{{.Config.Image}}' "$(container)")"
    migrate check > "$LOG/check-$TS.json" && say "schema check ok" || say "FAIL schema check, see $LOG/check-$TS.json"
    say "next: CONFIRM=yes $0 autodeploy on, then copy $HOME/dvote-backups/$TS-pre-perf-release off the host";;
  backup) SHA=${2:?SHA}; backup_db pre-go-online || { say "FAIL online backup"; exit 1; };;
  screen) need_confirm; SHA=${2:?SHA}; screen_apply | tee "$LOG/screen-$TS.json";;
  reopen-old) need_confirm
    api -X POST "$API/applications/$APP/start" -o /dev/null -w "start %{http_code}\n"
    for i in $(seq 1 120); do h=$(health); [ "$h" = 200 ] && break; sleep 2; done; say "reopened previous deployment, health $h";;
  *) sed -n '2,11p' "$0"; exit 1;;
esac
