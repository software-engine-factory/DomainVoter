# Production rollout plan

Status: planning only, 2026-10-30. No production tests, deployment, remote branch deletion or push is authorized by this document. The local branch archive and merge into `dev` are the only Git changes being carried out now.

The prepared cutover for the performance release, with rehearsal numbers, is in [the cutover runbook](cutover-runbook.md).

## Release flow

```text
perf/indexed-filtering-2026-10-29
  -> dev: integrate and validate locally
  -> main: future reviewed release promotion
  -> immutable application image: rehearse locally on fresh production data
  -> Coolify on Contabo A: future approved maintenance cutover
```

Production is a running application and its persistent volume, not another Git branch. A push to `main` may trigger Coolify automatically. Inspect that trigger before any future push and keep deployment disabled until the cutover is approved. Do not merge to `main` as part of this planning task.

The active upstream is `factory` (`software-engine-factory/DomainVoter`); local `main` tracks `factory/main`. `origin` is a separate older upstream. Both were fetched on this planning pass without pushing. Neither has a `dev` branch. Create local `dev` from current `main`, merge the tested feature branch with a merge commit, and leave `main` unchanged. Retain `main`, `dev` and the feature branch. Other local heads are retired only after the archive restore check described in [the archive record](branch-archive-2026-10-30.md).

## Data contract

- The current production database remains authoritative throughout the release. Deploy application code onto its existing persistent volume. Never replace it with the localhost preview or an older backup.
- New records, rounds, batches, votes and assignments added during development stay in that database. The migrations build indexes and summaries from the data present at cutover.
- Existing rounds retain their original membership rows and IDs. New creation jobs use compact selections and ranges. Only interacted names are materialized for vote/view foreign keys.
- Preserve the entire existing `/app/data` volume, including `voting.db`, `session.secret` and any creation-job manifests. Do not create a new empty volume during the release.
- New sets stored as ordinary records are data changes. New set categories, columns, migration versions or import formats require code/schema reconciliation. The current selectable pool categories are fixed by `src/lib/sets.ts`; do not assume a new category is automatically supported.
- No synthetic data, preview accounts, local benchmark rounds or branch archives are transferred to production.

## What is already checked

The integrated application source is commit `990e086`; evidence is in `aeb743d` and [the performance report](../research/performance-2026-10-29-final.md). The feature includes migrations 15 through 18. Local checks passed 48 tests, TypeScript validation, the optimized build, database integrity, vote preservation, real browser filtering and voting, and complete two-million-name creation parity.

At a combined application/SQLite/worker limit of 2 CPU and 2 GiB, the measured creation took 46.426 seconds for ten rounds of 200,000 names. That stopwatch excludes migration/index construction. The latest UI read changes were checked separately against the completed dataset. These are local results, not a production timing guarantee.

Broad never-used filters and arbitrary seeded-random ordering remain slow. They are recorded limitations, not release improvements to claim. The 1 CPU configuration also regressed vote latency during creation. Start the capacity review from the tested 2 CPU / 2 GiB envelope, one read worker and one active creation job, without assuming this capacity is reserved on the shared host.

## 1. Reconcile release source and production schema

This is future read-only preflight, not an instruction to contact production now.

1. Record the current production commit/image digest, Coolify resource identity, persistent volume identity and deployment trigger/ref. Record the rollback image digest.
2. Fetch current upstream refs. Reconcile new code on `factory/main` into `dev`; preserve production fixes. Re-run checks after any changed application code.
3. Inventory the actual production `user_version`, `schema_migrations`, required tables, columns, indexes, views and triggers. Compare definitions, not just the highest migration number.
4. Check whether versions 15 through 18 or their object names have been used by another change. Stop if they conflict. Do not mark conflicting migrations as applied, hide a mismatch with `IF NOT EXISTS`, or renumber migrations already applied to production.
5. Review newly introduced set categories and import formats. Data-only growth does not need a database merge; schema/category changes may need an application change.
6. Inventory active/failed creation jobs, import processes, scheduled writers and remaining legacy `free_names` rows. Do not cancel or delete people's jobs to simplify the release.

Exit condition: one reconciled source candidate, an exact migration starting point and no unresolved schema or category mismatch.

## 2. Build the missing release safeguards

These are implementation tasks for a later change. They are not implemented by this plan.

1. Add an explicit migration command packaged in the runtime image. It must call the same migration definitions as the app, report the applied versions, fail nonzero on an error and support the existing persistent data path. Do not depend on the first visitor to initialize the database.
2. Add database readiness separate from process liveness. Current `/health` only returns `ok`; `getSqlite()` currently performs migrations lazily. Keep liveness inexpensive. Readiness must remain false until the migration command succeeds and expected migration records/schema objects exist.
3. Make readiness read-only and bounded. Do not run full counts, integrity scans, migrations or the legacy free-name mover on every health probe.
4. Define and rehearse a maintenance mechanism that blocks writes and new jobs while preserving the existing hostname/proxy configuration. Include scheduled/external import writers, not just browser traffic.
5. Configure startup and failure handling so a migration failure keeps traffic closed and does not automatically start an incompatible old image against a partially upgraded database.
6. Keep legacy free-name movement disabled during migration and parity comparison with `DV_FREE_MOVE=off`. If there is a backlog, schedule its resumption separately after the migration result is accepted.

Required acceptance cases:

| Case | Required result |
| --- | --- |
| Unmigrated database | Process can start, but readiness fails and traffic remains closed. |
| Migration replay | Second run applies nothing and preserves IDs, rows and votes. |
| Schema/migration collision | Release stops before app traffic or further mutation. |
| Migration failure or interruption | Nonzero result; no false readiness; a checked retry/restore path exists. Each completed migration remains recorded. |
| Newly imported records and newly created rounds | Preserved by migration and included in index/summary parity. |
| Maintenance active | Browser writes, new creation jobs and scheduled/import writes cannot proceed. |
| Existing compact and materialized rounds | Both remain readable, with existing vote/view references and assignments intact. |

Exit condition: these safeguards are implemented, reviewed and checked locally. Until then, this branch is an integrated local candidate rather than a deployment-ready release.

## 3. Rehearse with a fresh backup, locally

1. Obtain a fresh, consistent production backup using SQLite's backup API. The repository's existing ops backup path uses that API and records integrity, SHA256 and totals. Do not copy only an actively written `voting.db` file while ignoring its WAL.
2. Wait for creation jobs to finish before collecting their supporting files, or arrange a consistent quiesced capture. An online database backup alone does not freeze filesystem job manifests.
3. Keep the original backup immutable. Use one disposable local working copy, with original session secrets protected and no application network access to production services.
4. Record source schema, row totals, stable IDs, round/batch/assignee counts and an ordered vote digest. Include legacy `free_names` in the inventory. Do not substitute the old October 29 benchmark totals for today's values.
5. Run the candidate image and explicit migration command under the proposed CPU/RAM caps, with legacy free movement off. Measure migration duration, peak memory, database growth, WAL growth and temporary disk usage. Do not infer downtime from the 46-second creation benchmark.
6. Require `quick_check=ok`, no foreign-key errors, unchanged original data/IDs/vote digest, correct summary totals and all expected migrations. Compare logical round membership through `domain_catalog`, not only physical `domains` counts.
7. On the disposable local copy only, check old and new rounds, assignments, visibility, exports, current prices versus historical snapshots, real votes/views, restart/resume and creation admission. Run the existing suite and targeted readiness/migration cases.
8. Test rollback before accepting new writes. Record the actual commands, artifacts and elapsed times. After accepting compact-round writes, prove any proposed old-image rollback separately; never assume compatibility.
9. Delete the disposable working copy when no longer needed. Preserve the original backup, evidence and one needed preview. No additional full-data copies should accumulate.

Exit condition: an attached rehearsal report with measured maintenance/disk requirements, parity results and demonstrated recovery.

## 4. Prepare the release artifact and approval

1. Review the `dev` candidate and its evidence. Future merge into `main` is a separate authorized promotion.
2. Before any remote push, inspect Coolify's watched branch/webhook. A push must not start an unapproved deployment. Arrange the approved deployment gate first.
3. Merge approved `dev` into current `main`, resolving any new upstream changes through normal review. Build and identify the exact release commit and immutable image digest.
4. Rehearse that exact final artifact locally. If it differs from the rehearsed artifact, repeat affected validation. Do not deploy a mutable tag or silently rebuild a different artifact during cutover.
5. In the deployment ticket, record the release/rollback digests, migration versions, current data volume, session/manifest handling, resource limits, measured disk headroom and maintenance duration, operator and restore procedure.
6. Obtain explicit authorization for shared-branch pushes, production configuration changes and the maintenance cutover. None is authorized by this planning task.

## 5. Execute the future maintenance cutover

This phase remains unexecuted. No production benchmarks, synthetic records or trial creation jobs are part of it.

1. Enter the approved maintenance state. Stop admission of new writes and jobs.
2. Let existing creation/import jobs finish and confirm every writer is quiescent, including external scripts. If they cannot finish within the window, postpone rather than discarding work.
3. Take a final consistent backup of the current database and required supporting files. Verify it and record the final pre-migration counts/digest. This final capture includes records created after the rehearsal backup.
4. Stop the old application instance. Do not overlap old/new app versions or run a rolling multi-replica upgrade against this SQLite volume.
5. Apply migrations to the existing production database with the explicit migration command. Keep traffic closed. On failure, stop here and use the pre-reopen recovery procedure.
6. Start the pinned release image using the same persistent volume and session secret. Apply reviewed resource caps and `DV_RO_WORKERS=1`; the database admission/lease mechanism continues to allow one active creation job.
7. Before reopening, run the agreed schema/integrity/data-preservation checks against the final capture. Confirm readiness and volume identity. These are release integrity checks, not load or synthetic-user tests.
8. Reopen normal traffic only when every release gate passes. Observe real errors, job state and resource consumption without generating production test workloads. Resume approved import schedules separately.

## 6. Recovery rules

| Point of failure | Action |
| --- | --- |
| Before migration | Keep maintenance in place or resume the unchanged old app; no restore is needed if nothing changed. |
| During migration, before reopening | Keep all writers stopped. Inspect the failure. Retry only the demonstrated recovery path, or restore the final quiesced backup together with the old image and required supporting files. Recheck integrity before reopening. |
| After reopening and new writes | Preserve the current volume. Prefer a reviewed forward fix. Do not automatically restore a backup or switch to an old image. |
| Old-image rollback requested after compact rounds exist | First demonstrate compatibility or a conversion/reconciliation on a fresh local copy. Preserve every post-cutover record and vote before any production restore. |

A database restore after reopening can lose newly created sets, records and votes. A code-only rollback can make compact rounds unreadable to the old application. These are separate risks; neither is covered by a generic Coolify image rollback button.

## Release completion evidence

- Approved release commit and deployed image digest match the rehearsed artifact.
- Expected migrations are applied; readiness passes after explicit migration completion.
- Existing data, IDs, assignments and votes match the final pre-cutover capture.
- Original backups are retained, and the production volume/session identity is preserved.
- Resource limits and one-active-creation admission are recorded.
- No production benchmark, synthetic user or preview dataset was introduced.
- Remaining slow never-used/random queries are documented honestly.
- Temporary working copies are removed and the rollback window/backup retention decision is recorded.

For this planning task, completion means the spec is committed, the ignored ZIP has been restored and verified, the intended branches remain, and the local merge is checked. It does not mean any production step above has been executed.
