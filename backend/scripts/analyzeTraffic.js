const fs = require('node:fs');
const { analyzeTraffic, renderReport } = require('../src/monitoring/analyzeTraffic');
function main(args) {
  const files = []; let output, employeeHours, json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { console.log('Usage: npm run analyze:traffic -- export.log [more.log] [--employee-hours 160] [--out baseline.md] [--json]\nReads exported full [metrics] log lines or one /api/metrics JSON snapshot. Runs offline; never connects to the CRM database.'); return; }
    if (arg === '--out' || arg === '--employee-hours') {
      const value = args[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--out') output = value; else employeeHours = Number(value);
    } else if (arg === '--json') json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (!files.length) throw new Error('Provide at least one exported log file. Use --help for instructions.');
  const data = analyzeTraffic(files.map(file => fs.readFileSync(file, 'utf8')), { employeeHours });
  const report = json ? JSON.stringify(data, null, 2) + '\n' : renderReport(data);
  if (output) { fs.writeFileSync(output, report, { flag: 'wx' }); console.log('Traffic report saved. Existing files are never overwritten.'); }
  else process.stdout.write(report);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`Traffic analysis failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { main };
