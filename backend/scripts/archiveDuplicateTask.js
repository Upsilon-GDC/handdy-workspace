// Preview first. Applies the CRM's reversible deletion semantics, never a
// physical delete or a rewrite of recorded time. No startup integration.
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EJSON } = require('bson');
const { archiveDuplicateTask } = require('../src/services/archiveDuplicateTask');
async function main() {
  const args = process.argv.slice(2), options = { apply: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') options.apply = true;
    else if (['--keep', '--retire', '--backup-dir'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else throw new Error('Use --keep TASK_ID --retire TASK_ID [--apply --backup-dir PATH].');
  }
  if (!options.keep || !options.retire || (options.apply && !options['backup-dir'])) throw new Error('Choose keep/retire IDs; applying also requires --backup-dir.');
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  if (process.env.MONGODB_DNS_SERVERS) require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim()));
  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 15000 });
    const result = await archiveDuplicateTask({ keepId: options.keep, retireId: options.retire, apply: options.apply,
      backup: async data => {
        const folder = path.resolve(options['backup-dir']); fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, `before-${options.retire}-${crypto.randomUUID()}.json`), EJSON.stringify(data, null, 2, { relaxed: false }), { flag: 'wx' });
      } });
    console.log(JSON.stringify(result));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.statusCode ? error.message : `Cleanup failed (${error.name}).`); process.exitCode = 1; });
