const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { argument, oldBackups } = require('./backupTools');
const { writeSnapshotBackup } = require('./snapshotBackup');

async function main() {
  require('dotenv').config();
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is required.');
  const root = path.resolve(argument('--out', path.join(__dirname, '..', 'backups')));
  const keep = Number(argument('--keep', '0'));
  if (!Number.isSafeInteger(keep) || keep < 0) throw new Error('--keep must be a non-negative integer.');
  fs.mkdirSync(root, { recursive: true });
  const folder = path.join(root, new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z'));
  try {
    await mongoose.connect(uri, { compressors: ['zlib'], autoIndex: false, autoCreate: false });
    await writeSnapshotBackup({ db: mongoose.connection.db, client: mongoose.connection.getClient(), folder,
      onCollection: async (name, count) => console.log(`${name}: ${count} documents`) });
    console.log(`Completed snapshot backup: ${folder}`);
    if (keep > 0) {
      for (const old of oldBackups(root, keep)) {
        const relative = path.relative(root, path.resolve(old));
        if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || !relative) throw new Error('Unsafe retention path.');
        fs.rmSync(old, { recursive: true, force: true });
        console.log(`Removed completed backup ${path.basename(old)}`);
      }
    }
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(`Backup failed: ${error.message}`); process.exitCode = 1; });
module.exports = { main };
