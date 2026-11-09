const path = require('node:path');
const mongoose = require('mongoose');
const { argument } = require('./backupTools');
const { restoreSnapshotBackup } = require('./snapshotBackup');
const { inspectRecovery } = require('./verifyRecovery');

async function main() {
  require('dotenv').config();
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is required.');
  const from = argument('--from');
  if (!from) throw new Error('--from is required.');
  const target = argument('--to-db');
  try {
    await mongoose.connect(uri, { compressors: ['zlib'], autoIndex: false, autoCreate: false });
    const client = mongoose.connection.getClient();
    const result = await restoreSnapshotBackup({ sourceDb: mongoose.connection.db, client, folder: path.resolve(from), target, allowLegacy: process.argv.includes('--allow-legacy') });
    if (result.consistency === 'legacy-unverified') console.warn('Legacy export: no original checksum or common snapshot can be verified. Independent recovery review is required.');
    const checks = await inspectRecovery(client.db(target));
    console.log(JSON.stringify({ ...result, checks }));
    if (checks.reviewRequired) throw new Error('Restore completed, but domain checks require review. Do not promote this database.');
    console.log(`Restore into "${target}" completed; files, counts, indexes and recovery checks verified.`);
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; });
module.exports = { main };
