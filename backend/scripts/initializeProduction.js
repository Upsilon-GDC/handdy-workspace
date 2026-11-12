// Preview by default. Never run from server startup or alter existing time logs.
const mongoose = require('mongoose');
const path = require('node:path');
const { initializeProduction } = require('../src/services/production/initialization');
const { fail } = require('../src/services/production/settingsValidation');

function parseArguments(args) {
  const options = { apply: false };
  const names = { '--team-id': 'billingTeamId', '--effective-from': 'effectiveFrom', '--currency': 'currency', '--actor': 'actorId' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--apply') options.apply = true;
    else if (flag === '--help') options.help = true;
    else if (names[flag] && args[index + 1] && !args[index + 1].startsWith('--')) options[names[flag]] = args[++index];
    else throw fail('Unknown or incomplete initialization option. Use --help.');
  }
  if (!options.help && (!options.effectiveFrom || !options.currency || (options.apply && !options.actorId))) throw fail('Provide --effective-from and --currency; --apply also requires --actor.');
  return options;
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Preview: node scripts/initializeProduction.js --effective-from YYYY-MM-DD --currency USD [--team-id WCPA_ID]');
    console.log('Apply: add --apply --actor ADMIN_ID. Existing configuration is preserved. No rates or time entries are imported or changed.');
    return;
  }
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  if (!process.env.MONGODB_URI) throw fail('Database is not configured.');
  if (process.env.MONGODB_DNS_SERVERS) require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim()));
  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 15000, maxPoolSize: 2 });
    console.log(JSON.stringify(await initializeProduction(options), null, 2));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => {
  // Driver messages may contain credentials/hosts. Only application validation
  // messages are safe to print to an operator's terminal.
  console.error(error.statusCode ? error.message : `Initialization failed (${error.name}).`);
  process.exitCode = 1;
});
module.exports = { parseArguments };
