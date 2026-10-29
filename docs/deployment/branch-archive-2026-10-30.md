# Local branch archive, 2026-10-30

Archive: `.branch-archives/2026-10-30_000630/domainvoter-branches.zip`.

SHA256: `d4f574dfb5a3ed6826748e9b86a4ed04989538884e63f696c35a669dbd2fef26`.

Size: 6,368,988 bytes, about 6.1 MiB. The archive is excluded by `.gitignore` and `.dockerignore`; it is local, not part of the release image or Git push.

The ZIP contains seven independent source ZIPs, a self-contained `branches.bundle` with their full reachable Git history, a commit/hash manifest and `RESTORE.md`. The six retired branch heads remain recoverable. `main` is also archived as a safety snapshot and remains an active branch.

| Branch | Saved commit | Local action |
| --- | --- | --- |
| `feature/multi-length-round-upload` | `2899e47` | Archived; local ref retired |
| `main` | `8b37129` | Keep unchanged |
| `preview/background-creation-2026-10-29` | `9e53fae` | Archived; local ref retired |
| `research/local-performance-2026-10-28` | `2aca0a2` | Archived; local ref retired |
| `research/perf-frontend-2026-10-28` | `017e62b` | Archived; local ref retired |
| `research/perf-sql-2026-10-28` | `2574332` | Archived; local ref retired |
| `research/perf-worker-2026-10-28` | `fd252c5` | Archived; local ref retired |

Kept branches are `main`, newly created `dev`, and `perf/indexed-filtering-2026-10-29`. The current feature branch is already retained in the repository and is not duplicated as a source ZIP. Remote refs are untouched. The separate detached `DV-hide-register` worktree is untouched.

## Verification before retiring refs

1. `git bundle verify` passed with no missing prerequisites.
2. The outer ZIP and every source ZIP passed CRC checks. Each source ZIP's embedded commit ID matched the manifest.
3. Bundle/source SHA256 values matched the final ZIP contents.
4. The bundle extracted from the final ZIP was fetched into a temporary empty bare repository. All seven restored branch names and full commit IDs matched exactly.
5. `git fsck --full` passed on that restored repository.
6. Temporary archive-building and verification copies are removed after the checks. The final ZIP and small verification record are retained.

## Restore

Expand the ZIP into a temporary local folder. Run `git bundle verify <expanded-folder>/branches.bundle`. Restore an absent branch with:

```text
git fetch <expanded-folder>/branches.bundle refs/heads/<saved-branch>:refs/heads/<saved-branch>
```

To avoid replacing any existing branch, use `refs/heads/restored/<saved-branch>` as the destination. Compare the restored commit with `manifest.json`. Each `snapshots/*.zip` can also be opened independently without Git.

No original database backups were changed or included. The archive preserves source/history; it is not a backup of application data.
