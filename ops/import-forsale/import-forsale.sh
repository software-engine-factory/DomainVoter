#!/bin/bash
# DomainVoter for-sale import runbook (contabo). Repeatable; every live step is backed up first.
#   import-forsale.sh validate TAG...      file checks only (manifest, sha256, columns, counts, tag, length)
#   import-forsale.sh rehearse TAG...      fresh online backup of prod -> import on the COPY -> verify -> undo test on the copy
#   CONFIRM=yes import-forsale.sh apply TAG...   backup -> import into LIVE prod -> verify -> backup
#   CONFIRM=yes import-forsale.sh undo  TAG...   backup -> delete rows brought by TAG from LIVE pool/free_names
#   import-forsale.sh backup [label]       online backup of prod (+ sha256, integrity_check, counts)
#   CONFIRM=yes import-forsale.sh restore BACKUP_DIR   stop app (Coolify API) -> put backup in place -> start app
#   import-forsale.sh stats [db]           counts per table/tag + rounds/domains hashes (default: live, read-only)
# Node work runs in a throwaway container of the prod image (same better-sqlite3), never in the running app.
set -euo pipefail
APP=isawmwwcmnfj28hyo3irrvt0
HERE=$HOME/dvote-import
DATA=${DATA:-$HOME/forsale/data}
BK=$HOME/dvote-backups
VOL=/var/lib/docker/volumes/$APP-dvote-data/_data
LOG=$HERE/logs; mkdir -p "$LOG" "$HERE/work"
TS=$(date +%Y%m%d-%H%M%S)
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG/run-$TS.log" >&2; }
need_confirm() { [ "${CONFIRM:-}" = yes ] || { echo "refusing: live step needs CONFIRM=yes" >&2; exit 1; }; }
container() { sudo -n docker ps --filter "name=$APP" --format '{{.Names}}' | head -1; }
C=$(container); [ -n "$C" ] || { echo "app container not running" >&2; exit 1; }
IMG=$(sudo -n docker inspect -f '{{.Config.Image}}' "$C")
APPUID=$(sudo -n docker exec "$C" id -u nextjs); APPGID=$(sudo -n docker exec "$C" id -g nextjs)
# run node CLI in a throwaway container: $1 = extra docker args, rest = CLI args
cli() { local extra=$1; shift; sudo -n docker run --rm --network none $extra -e NODE_PATH=/app/node_modules \
  -v "$HERE/import-forsale.cjs:/tool/import-forsale.cjs:ro" -v "$DATA:/in:ro" --entrypoint node "$IMG" /tool/import-forsale.cjs "$@"; }

backup() { # online backup via the SQLite backup API (= sqlite3 .backup), run as the app user in a throwaway container
  local label=${1:-manual}; local out="$BK/$TS-$label"; mkdir -p "$out"; chmod 777 "$out"
  cli "-u $APPUID:$APPGID -v $VOL:/app/data -v $out:/out" backup --db /app/data/voting.db --out /out/voting.db >&2
  sudo -n chown "$(id -u):$(id -g)" "$out/voting.db"; chmod 600 "$out/voting.db"; chmod 700 "$out"
  local ic; ic=$(sqlite3 -readonly "$out/voting.db" 'pragma integrity_check' | head -1)
  [ "$ic" = ok ] || { say "BACKUP INTEGRITY FAILED: $ic"; exit 1; }
  (cd "$out" && sha256sum voting.db > voting.db.sha256)
  sqlite3 -readonly "$out/voting.db" "select json_object('integrity','$ic','user_version',(select max(version) from schema_migrations),'pool',(select count(*) from pool),'free_names',(select count(*) from free_names),'rounds',(select count(*) from rounds),'domains',(select count(*) from domains),'votes',(select count(*) from votes),'bytes',(select page_count*page_size from pragma_page_count, pragma_page_size))" > "$out/meta.json"
  say "backup $out $(cat "$out/meta.json") sha256=$(cut -c1-16 "$out/voting.db.sha256")…"
  echo "$out"
}
validate() { for t in "$@"; do say "validate $t"; cli "" validate --dir /in --tag "$t" | tee -a "$LOG/run-$TS.log"; done; }
diskcheck() { local avail; avail=$(df --output=avail -BM "$HOME" | tail -1 | tr -dc 0-9); say "disk free ${avail}MB"; [ "$avail" -gt 3000 ] || { say "less than 3 GB free, stop"; exit 1; }; }

case "${1:-}" in
  validate) shift; validate "$@";;
  backup) shift; backup "${1:-manual}" >/dev/null;;
  stats) shift; if [ -n "${1:-}" ]; then d=$(dirname "$(readlink -f "$1")"); cli "-u $(id -u):$(id -g) -v $d:/w" stats --db "/w/$(basename "$1")" --integrity;
         else cli "-u $APPUID:$APPGID -v $VOL:/app/data" stats --db /app/data/voting.db; fi;;
  rehearse) shift; diskcheck; validate "$@"
    src=$(backup "pre-rehearsal"); W=$HERE/work/rehearse-$TS; mkdir -p "$W"; cp "$src/voting.db" "$W/voting.db"
    R="-u $(id -u):$(id -g) -v $W:/w"
    cli "$R" stats --db /w/voting.db --integrity > "$W/stats-before.json"
    for t in "$@"; do say "dry-run $t"; cli "$R" import --db /w/voting.db --dir /in --tag "$t" --dry-run > "$W/dry-$t.json"; done
    for t in "$@"; do say "import $t (copy)"; s=$(date +%s%N); cli "$R" import --db /w/voting.db --dir /in --tag "$t" > "$W/import-$t.json"; say "  $t took $(( ($(date +%s%N) - s) / 1000000 ))ms incl. container start"; done
    cli "$R" stats --db /w/voting.db --integrity > "$W/stats-after.json"
    cp "$W/voting.db" "$W/imported.db"
    for t in "$@"; do say "undo $t (copy)"; cli "$R" undo --db /w/voting.db --tag "$t" > "$W/undo-$t.json"; done
    cli "$R" stats --db /w/voting.db --integrity > "$W/stats-undone.json"
    python3 "$HERE/report.py" "$W" "$@" | tee "$W/report.txt"
    rm -f "$W/voting.db" "$W/voting.db-wal" "$W/voting.db-shm"; say "rehearsal dir $W (imported.db kept for app checks; delete when done)";;
  apply) shift; need_confirm; diskcheck; validate "$@"
    pre=$(backup "pre-import-$(echo "$*" | tr ' ' '+')")
    L="-u $APPUID:$APPGID -v $VOL:/app/data"
    for t in "$@"; do say "LIVE import $t"; cli "$L" import --db /app/data/voting.db --dir /in --tag "$t" | tee "$LOG/apply-$TS-$t.json"; done
    cli "$L" stats --db /app/data/voting.db | tee "$LOG/apply-$TS-stats.json" >/dev/null
    post=$(backup "post-import-$(echo "$*" | tr ' ' '+')")
    say "done. pre=$pre post=$post. health $(curl -s -o /dev/null -w '%{http_code}' https://dvote.kayhan.world/health)";;
  undo) shift; need_confirm; pre=$(backup "pre-undo-$(echo "$*" | tr ' ' '+')")
    L="-u $APPUID:$APPGID -v $VOL:/app/data"
    for t in "$@"; do say "LIVE undo $t"; cli "$L" undo --db /app/data/voting.db --tag "$t" | tee "$LOG/undo-$TS-$t.json"; done;;
  restore) shift; need_confirm; B=${1:?backup dir}; [ -f "$B/voting.db" ] || { echo "no $B/voting.db" >&2; exit 1; }
    (cd "$B" && sha256sum -c voting.db.sha256) || { say "sha256 mismatch, stop"; exit 1; }
    safety=$(backup "pre-restore"); say "safety backup $safety"
    T=$(tr -d '\r\n' < ~/.coolify-dvote-token)
    curl -s -o /dev/null -w "stop %{http_code}\n" -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$APP/stop"
    for i in $(seq 1 30); do [ -z "$(container)" ] && break; sleep 2; done; [ -z "$(container)" ] || { say "app did not stop"; unset T; exit 1; }
    sudo -n rm -f "$VOL/voting.db-wal" "$VOL/voting.db-shm"; sudo -n cp "$B/voting.db" "$VOL/voting.db"; sudo -n chown "$APPUID:$APPGID" "$VOL/voting.db"; sudo -n chmod 644 "$VOL/voting.db"
    curl -s -o /dev/null -w "start %{http_code}\n" -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$APP/start"; unset T
    for i in $(seq 1 60); do sleep 5; h=$(curl -s -o /dev/null -w '%{http_code}' https://dvote.kayhan.world/health); [ "$h" = 200 ] && break; done; say "restored $B, health $h";;
  *) sed -n '2,10p' "$0"; exit 1;;
esac
