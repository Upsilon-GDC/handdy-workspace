const fs = require('node:fs');
const { analyzeTraffic, renderReport } = require('../src/monitoring/analyzeTraffic');
const { analyzeEmployeeTraffic, renderEmployeeReport } = require('../src/monitoring/analyzeEmployeeTraffic');
function main(args) {
  const files = []; let output, employeeHours, json = false, employees = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { console.log('Usage: npm run analyze:traffic -- export.log [more.log] [--employees] [--employee-hours 160] [--out baseline.md] [--json]\nDefault: full [metrics] log lines or one /api/metrics snapshot. --employees: compare exported [employee-traffic] intervals by employee and app version. Runs offline; never connects to the CRM database.'); return; }
    if (arg === '--out' || arg === '--employee-hours') {
      const value = args[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--out') output = value; else employeeHours = Number(value);
    } else if (arg === '--json') json = true;
    else if (arg === '--employees') employees = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (!files.length) throw new Error('Provide at least one exported log file. Use --help for instructions.');
  if (employees && employeeHours !== undefined) throw new Error('--employee-hours applies only to aggregate traffic, not employee interval comparisons.');
  const contents = files.map(file => fs.readFileSync(file, 'utf8'));
  const data = employees ? analyzeEmployeeTraffic(contents) : analyzeTraffic(contents, { employeeHours });
  const report = json ? JSON.stringify(data, null, 2) + '\n' : employees ? renderEmployeeReport(data) : renderReport(data);
  if (output) { fs.writeFileSync(output, report, { flag: 'wx' }); console.log('Traffic report saved. Existing files are never overwritten.'); }
  else process.stdout.write(report);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`Traffic analysis failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { main };
