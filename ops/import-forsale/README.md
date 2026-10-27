# For-sale import runbook (ops)

Offline import of a for-sale tag (pool rows + registrable names) into the live DB, run on the host.

Build the bundles next to the script (not committed):

```sh
npx esbuild scripts/ops/import-forsale.ts --bundle --platform=node --format=cjs --alias:@=./src \
  --external:better-sqlite3 --external:bcryptjs --outfile=ops/import-forsale/import-forsale.cjs
npx esbuild scripts/ops/bench-browse.ts --bundle --platform=node --format=cjs --alias:@=./src \
  --external:better-sqlite3 --external:bcryptjs --outfile=ops/import-forsale/bench-browse.cjs
```

Copy the folder to the host (`~/dvote-import/`), then:

```sh
./import-forsale.sh validate TAG...      # files, sha256, columns, manifest counts
./import-forsale.sh rehearse TAG...      # full import on a copy of the live DB
CONFIRM=yes ./import-forsale.sh apply TAG...   # backup → import live → backup → frozen-hash check
./import-forsale.sh undo TAG | backup LABEL | stats | restore DIR
```

Node work runs in a throwaway container of the deployed app image; backups go to `~/dvote-backups/<ts>-<label>/`
(`voting.db`, `voting.db.sha256`, `meta.json`). Rounds, votes, views and users are hashed before/after and must match.
