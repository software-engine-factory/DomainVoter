#!/usr/bin/env bash
# Run on K's PC (Git Bash): copy a backup off Contabo A into this repo's .backups/ (git-ignored) and check it.
#   ops/release/fetch-backup.sh [remote folder]   default: the newest ~/dvote-backups/* on the host
# Lands in .backups/<folder name>/ (dated, e.g. 20261030-152300-pre-go-online); fails unless sha256 matches.
set -euo pipefail
B=${1:-$(ssh contabo 'ls -1d ~/dvote-backups/*/ | tail -1')}; B=${B%/}
L="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/.backups/$(basename "$B")"
mkdir -p "$L"
scp "contabo:$B/voting.db" "contabo:$B/voting.db.sha256" "contabo:$B/meta.json" "$L/"
(cd "$L" && sha256sum -c voting.db.sha256)
echo "backup copied to $L: $(cat "$L/meta.json")"
