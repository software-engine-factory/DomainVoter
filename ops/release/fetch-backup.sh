#!/usr/bin/env bash
# Run on K's PC (Git Bash) after `cutover.sh go`: copy the final backup off Contabo A and check it.
#   ops/release/fetch-backup.sh [remote folder]   default: the newest ~/dvote-backups/*-pre-perf-release
# Lands in D:/K Studio/backups/dvote/<folder name>/; fails unless the local sha256 matches the host's.
set -euo pipefail
B=${1:-$(ssh contabo 'ls -1d ~/dvote-backups/*-pre-perf-release | tail -1')}
L="D:/K Studio/backups/dvote/$(basename "$B")"
mkdir -p "$L"
scp "contabo:$B/voting.db" "contabo:$B/voting.db.sha256" "contabo:$B/meta.json" "$L/"
(cd "$L" && sha256sum -c voting.db.sha256)
echo "backup copied to $L: $(cat "$L/meta.json")"
