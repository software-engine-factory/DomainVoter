#!/usr/bin/env bash
# Performance release cutover on Contabo A (Coolify app isawmwwcmnfj28hyo3irrvt0). Runbook: docs/deployment/cutover-runbook.md
#   cutover.sh preflight SHA                 read-only: running app, prebuilt image, Coolify settings, disk, other writers
#   CONFIRM=yes cutover.sh autodeploy on|off  Coolify "auto deploy on push" (off before pushing main, on again after)
#   CONFIRM=yes cutover.sh go SHA            backup -> stop -> migrate (new image) -> deploy prebuilt image -> verify
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
migrate() { sudo -n docker run --rm --network none -u "$(sudo -n stat -c %u:%g "$VOL/voting.db")" -e NODE_PATH=/app/node_modules -v "$VOL:/app/data" \
  -v "$HERE/migrate.cjs:/tool/migrate.cjs:ro" --entrypoint node "$APP:$SHA" /tool/migrate.cjs "$@" --db /app/data/voting.db; }

preflight() {
  local ok=1 c img
  c=$(container); [ -n "$c" ] || { say "FAIL app container not running"; ok=0; }
  [ -n "$c" ] && { img=$(sudo -n docker inspect -f '{{.Config.Image}}' "$c"); say "running $c image $img health $(health)"; }
  [ -n "$c" ] && [ "$img" = "$APP:$SHA" ] && { say "FAIL release image is already running"; ok=0; }
  sudo -n docker image inspect "$APP:$SHA" >/dev/null 2>&1 && say "release image $APP:$SHA present" || { say "FAIL release image $APP:$SHA not loaded"; ok=0; }
  [ -f "$HERE/migrate.cjs" ] && say "migrate.cjs $(sha256sum "$HERE/migrate.cjs" | cut -c1-16)" || { say "FAIL $HERE/migrate.cjs missing"; ok=0; }
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
    say "safety backup (online, no downtime)"; "$HOME/dvote-import/import-forsale.sh" backup pre-perf-release >/dev/null
    T0=$(date +%s); say "DOWNTIME START: stopping app"
    api "$API/applications/$APP/stop" -o /dev/null -w "stop %{http_code}\n"
    for i in $(seq 1 60); do [ -z "$(container)" ] && break; sleep 1; done
    [ -z "$(container)" ] || { say "FAIL app did not stop; starting nothing, investigate"; exit 1; }
    say "stopped after $(( $(date +%s) - T0 ))s; migrating"
    if ! migrate apply --quick-check | tee "$LOG/migrate-$TS.json"; then
      say "FAIL migration (see $LOG/migrate-$TS.json). App is DOWN. Decide: CONFIRM=yes $0 reopen-old, or restore the backup"; exit 1
    fi
    say "migrated after $(( $(date +%s) - T0 ))s; deploying prebuilt $APP:$SHA"
    D=$(api "$API/deploy?uuid=$APP&force=false" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployments"][0]["deployment_uuid"])')
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
    say "next: CONFIRM=yes $0 autodeploy on";;
  reopen-old) need_confirm
    api "$API/applications/$APP/start" -o /dev/null -w "start %{http_code}\n"
    for i in $(seq 1 120); do h=$(health); [ "$h" = 200 ] && break; sleep 2; done; say "reopened previous deployment, health $h";;
  *) sed -n '2,8p' "$0"; exit 1;;
esac
