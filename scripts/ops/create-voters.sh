#!/usr/bin/env bash
# Creates voter accounts user1..user5 on the live DomainVoter, AFTER the deploy.
# Run on the server:  sudo bash create-voters.sh
# - passwords: random 20 chars, generated here, written ONLY to $OUT (root:root, 600), never printed
# - hashing happens inside the app container with the app's own bcryptjs (cost 10)
# - existing usernames are left untouched and are not written to $OUT
set -euo pipefail
umask 077
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

APP_UUID="${APP_UUID:-isawmwwcmnfj28hyo3irrvt0}"
COUNT="${COUNT:-5}"
OUT="${OUT:-/root/dvote-voter-credentials.txt}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -e "$OUT" ] && { echo "$OUT already exists; move it away first (not overwriting credentials)" >&2; exit 1; }
CID="$(docker ps --filter "name=${APP_UUID}" --format '{{.ID}}' | head -n1)"
[ -n "$CID" ] || { echo "app container for ${APP_UUID} not running" >&2; exit 1; }

tmp="$(mktemp)"; trap 'shred -u "$tmp" 2>/dev/null || rm -f "$tmp"' EXIT
for i in $(seq 1 "$COUNT"); do
  pw="$(head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 20)"
  [ "${#pw}" -eq 20 ] || { echo "password generation failed" >&2; exit 1; }
  printf 'user%s\t%s\n' "$i" "$pw" >> "$tmp"
done

docker cp "$HERE/create-voters.cjs" "$CID:/tmp/create-voters.cjs" >/dev/null
status="$(docker exec -i -w /app "$CID" node /tmp/create-voters.cjs < "$tmp")"
docker exec "$CID" rm -f /tmp/create-voters.cjs

created="$(printf '%s\n' "$status" | sed -n 's/^\(user[0-9]*\): created.*/\1/p')"
{ echo "# DomainVoter voter accounts — created $(date -Is). Login: https://dvote.kayhan.world"; echo "# username<TAB>password"
  for u in $created; do grep "^${u}"$'\t' "$tmp"; done; } > "$OUT"
chown root:root "$OUT"; chmod 600 "$OUT"
echo "$status"
echo "credentials written to $OUT (root only, 600)"
