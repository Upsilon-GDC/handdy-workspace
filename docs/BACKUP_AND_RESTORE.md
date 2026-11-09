# Backup and restore

Phase 6, 9 November 2026. These are operating instructions; production backup settings and production recovery have not been inspected or changed.

## Recovery choices

Check the cluster's Atlas Backup settings, retention and available restore points. Prefer a managed point-in-time recovery mechanism for larger databases. Record the actual configured schedule and perform an isolated restore drill. This repository's logical backup is an additional recovery option, not proof that Atlas backup is enabled.

The revised script uses a single MongoDB snapshot session for all collection data. It requires a deployment supporting snapshot reads outside transactions (MongoDB 5.0+); local verification uses a MongoDB 7.0.24 replica set. A snapshot can expire during a long export, so a large export may fail rather than silently change consistency. See [MongoDB snapshot read concern](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/).

Freeze schema/index/collection changes for the export. Catalog metadata is checked before and after data export; metadata is not part of the data snapshot. The script refuses views, capped/time-series and encrypted collections. Use database-native backup tooling for those configurations. There is no non-snapshot fallback.

## Create a backup

Use a private read-only database credential that can read the application database and list its collection/index metadata. Supply `MONGODB_URI` through the environment or ignored `backend/.env`. Never commit it. Use the repository's Node 24 runtime and installed backend dependencies.

```powershell
cd backend
node scripts/backupDatabase.js --out D:\CRM-backups --keep 30
```

Each newly created dated folder contains gzipped Extended JSON, including original BSON numeric/date/ObjectId types, and a format-2 manifest with per-file SHA-256, counts, indexes, collection options, and the snapshot timestamp. A complete manifest appears only after the export and metadata checks succeed. Treat a folder without that manifest as incomplete. Stream, filesystem, cursor and snapshot failures cause a nonzero exit and do not prune old backups.

`--keep 30` prunes only completed format-2 dated folders in the chosen output directory, after a successful export. It leaves incomplete folders, legacy exports and other folders alone. Keep long-term/monthly copies separately. A same-second filename collision fails without overwriting an existing backup.

Protect backups on encrypted, access-controlled storage outside the repository. Checksums detect corruption; they do not authenticate a backup against an attacker who can replace its manifest. Retention is deletion: use a dedicated backup directory. A scheduler should alert on nonzero exit and check completion, not merely the presence of a directory.

For Windows Task Scheduler, use `node` with arguments `scripts\backupDatabase.js --out D:\CRM-backups --keep 30`, set the working directory to the repository's `backend` folder, and use an account with access to the credential and backup storage. Run it manually once before scheduling. No scheduled task has been created by this phase.

## Restore to a new, empty database

Use a database credential authorized to create a separate recovery database. Keep its target name unique and reserve it exclusively for this drill; no application or other operator may write there during restore. Keep the source backup directory read-only throughout preflight and restore.

```powershell
cd backend
node scripts/restoreDatabase.js --from D:\CRM-backups\2026-11-09T21-00-00Z --to-db crm_restore_20261109
```

The script refuses the connected/source database, the manifest's original database, admin/local/config databases, and targets containing any collections. It never drops existing collections. Every file's path, checksum, gzip/JSON readability and document count is verified before database writes. Collection options/validators and indexes are recreated, and restored counts are checked. An empty collection is recreated as well.

A failure after insertion begins can leave a partially populated recovery target. It is not promoted or silently overwritten on retry; investigate it and use another fresh target. This is deliberately not a database-wide restore transaction.

Older backups remain recoverable only with explicit `--allow-legacy`. That path validates readability/counts and empty-target safety, but cannot establish an original checksum or common snapshot. The result is labeled `legacy-unverified`; independent review is mandatory. Legacy and incomplete exports are never automatically pruned by the new retention code.

## Verify recovery before promotion

After restoring, the CLI performs read-only domain checks for duplicate active timers, invalid/overlapping time intervals, missing time-log employee/project/task references, orphaned correction audits, and mismatched attendance presence/check-in/checkout for days with time entries. It prints counts without employee details. Findings cause a nonzero exit and require review, not automatic deletion or repair.

A consistent database snapshot can still capture an application-derived attendance update in flight; it does not make separate application writes transactional. Historical missing references/overlaps may also predate the backup. The verifier does not prove every business invariant: it does not compare every billing/export result, audit snapshot, activity mapping, attendance-hours formula, or historical attendance-only day. Use the application's authorized reconciliation/correction workflows where appropriate, then recheck reports.

Also verify representative employee permissions, recent work/break/idle totals, overnight attendance, client/billing reports, correction history, and settings against an independently recorded sample. Use the original `APP_TIMEZONE`. Keep recovered sessions isolated from employee clients during the drill. TTL-indexed records may expire during recovery, so count/check results can require investigation.

Record the backup path, snapshot time, restore target, verification counts, sample results, operator and date. Repeat recovery drills on a defined schedule (for example quarterly) and after backup-format changes. The local disposable test suite is not a production restore drill.

To rerun the read-only domain checks after review/correction, with the connection still configured for the original database: `node scripts/verifyRecovery.js --db crm_restore_20261109`. It refuses the configured source/system databases and returns nonzero for findings or an empty recovery database. It never edits records.

## Real recovery

Restore to a fresh database, resolve/review findings, and complete the sample checks before deliberately pointing the application at it. Pause writers during cutover, preserve the damaged database, and verify the configured backup/recovery point. Records after that point are absent and need separately authorized reconstruction. No cutover, destructive cleanup, production backup or production restore was performed during implementation.
