# Backup and restore

All CRM records (employees, time logs, attendance, billing rates, sessions, settings) live in one
MongoDB Atlas database. The code is in GitHub and the installers in GitHub Releases, so the database
is the one thing that cannot be rebuilt.

## 1. Check what Atlas already does (5 minutes)

Atlas → your project → the cluster → **Backup** tab.

- **Snapshots are listed** (Cloud Backup is on): note the schedule and how long snapshots are kept.
  You can restore a snapshot from that tab, ideally to a *new* cluster first. Still do the restore
  drill in step 4 once.
- **The tab says backups are not available for this tier** (free and shared tiers): nothing is being
  saved. Use the backup script below on a schedule.

Also write down, somewhere safe and outside the repository: the `MONGODB_URI`, the Render
environment values (`SMTP_*`, `CORS_ORIGINS`, `FRONTEND_URL`). If `JWT_SECRET` is ever lost or changed,
nothing is lost but everyone has to sign in again.

## 2. The backup script

`backend/scripts/backupDatabase.js` copies every collection into a dated folder: one gzipped file per
collection plus `manifest.json` with the record counts and indexes. It only reads the database.

One-time setup on the PC that will run it (any Windows PC that stays on, or a server):

1. Install Node.js 20.19 or newer.
2. Get the repository and run `npm ci --prefix backend`.
3. In Atlas → **Database Access**, add a user just for backups with the built-in role **Read any
   database** (it cannot change anything). Put its address in `backend/.env`:
   `MONGODB_URI=mongodb+srv://backup-user:…@…/<database>`.
   `backend/.env` is ignored by git; never commit it.

Run a backup:

```bash
cd backend
node scripts/backupDatabase.js --out D:\CRM-backups --keep 30
```

`--keep 30` keeps the newest 30 backups in that folder and deletes older ones. The output lists every
collection with its record count.

**Backups contain personal data.** Keep the folder on an encrypted, access-controlled drive (for
example a company OneDrive/SharePoint folder or BitLocker drive), never in the repository. The
default folder `backend/backups/` is ignored by git for that reason.

## 3. Run it every day (Windows Task Scheduler)

1. Task Scheduler → **Create Task** → name it "CRM database backup". Tick "Run whether user is logged
   on or not".
2. **Triggers** → New → Daily, at a quiet time (for example 21:00).
3. **Actions** → New → Program: `node` (or the full path, e.g. `C:\Program Files\nodejs\node.exe`),
   Arguments: `scripts\backupDatabase.js --out D:\CRM-backups --keep 30`,
   Start in: the repository's `backend` folder.
4. Save, then right-click → **Run** once and check that a new dated folder appears.

Keep monthly copies longer than 30 days if billing records must be kept (for example copy the first
backup of each month to a separate "monthly" folder).

## 4. Restore drill (do it once now, then every 3 months)

A backup only counts once it has been restored. `backend/scripts/restoreDatabase.js` restores into a
**separate** database and never touches the live one (it refuses the database named in
`MONGODB_URI`).

The drill needs a database user that may write to the test database (your admin user, not the
read-only backup user):

```bash
cd backend
node scripts/restoreDatabase.js --from D:\CRM-backups\2026-10-26T21-00-00Z --to-db crm_restore_test
```

Every collection prints `OK` with its counts and indexes, and the run ends with
`Restore … complete and verified`. To look at the restored data, run the backend locally with
`MONGODB_URI` pointing at `…/crm_restore_test` and open the dashboard. Afterwards delete the
`crm_restore_test` database in Atlas (Collections → database → Drop).

Record the date and result of each drill.

## 5. Real recovery

1. Restore the chosen backup into a **new** database name (step 4 command, e.g. `--to-db crm_recovered`).
2. Check it locally as in step 4 (sign in, open reports for recent days).
3. In Render → Environment, change `MONGODB_URI` so its database name is the recovered one. Render
   restarts the service with it.
4. Keep the damaged database untouched until you are sure; delete it later.

Records created after the backup was taken are not in it. Employees can add missing hours as manual
entries.
