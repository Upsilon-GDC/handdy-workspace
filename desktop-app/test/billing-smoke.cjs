// Hidden browser and loopback fixtures. Does not contact the deployed CRM.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ExcelJS = require('../../dashboard/node_modules/exceljs');
const { aggregateBillingLogs, aggregateBillingMembers, productionBillingReport, getBillingDateRange } = require('../../backend/src/utils/billingUtils');
const root = path.resolve(__dirname, '../../dashboard/dist'), output = path.resolve(__dirname, '../../output/billing-all-members');
const user = { _id: 'admin', role: 'admin', fullName: 'Admin' };
const employees = [{ _id: 'a', fullName: 'Ada Member', employeeId: 'E1', team: 'tax', projectRates: [{ project: 'project', chargeRate: 25 }] },
  { _id: 'b', fullName: 'Ben Member', employeeId: 'E2', team: 'tax', projectRates: [{ project: 'project', chargeRate: 40 }] },
  { _id: 'c', fullName: 'No Time Member', employeeId: 'E3', team: null, projectRates: [] }];
const teams = [{ _id: 'tax', teamName: 'Tax team' }, { _id: 'empty', teamName: 'Empty team' }], requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
  }
  let body = {};
  if (url.pathname === '/api/auth/me') body = { user };
  if (url.pathname === '/api/permissions/me') body = { permissions: [] };
  if (url.pathname === '/api/billing/employees') body = { employees, teams };
  if (['/api/billing/report', '/api/billing/production'].includes(url.pathname)) {
    const query = Object.fromEntries(url.searchParams); requests.push({ ...query, endpoint: url.pathname });
    const { employee: employeeId, team, startDate, endDate } = query;
    const selected = employeeId === 'all' ? employees.filter(person => team === 'all' || person.team === (team === 'unassigned' ? null : team)) : employees.filter(person => person._id === employeeId);
    const range = getBillingDateRange(startDate, endDate, 'UTC');
    const reports = selected.map(employee => aggregateBillingLogs({ employee, startDate, endDate, timezone: 'UTC', rangeStart: range.start, rangeEnd: range.endExclusive,
      logs: employee._id === 'c' ? [] : [{ _id: `log-${employee._id}`, employee: employee._id, project: 'project', task: 'task', projectRecord: { _id: 'project', projectName: 'Tax Filing', clientName: 'ABC Company' }, taskRecord: { _id: 'task', taskName: 'Document Review', taskType: 'work' }, startedAt: `${startDate}T09:00:00Z`, stoppedAt: `${startDate}T${employee._id === 'a' ? '10:15' : '10:00'}:00Z`, pauses: employee._id === 'a' ? [{ pausedAt: `${startDate}T09:30:00Z`, resumedAt: `${startDate}T09:45:00Z`, reason: 'idle' }] : [] }] }));
    body = { report: employeeId === 'all' ? aggregateBillingMembers({ reports, scope: { type: team === 'all' ? 'company' : 'team', teamId: team, label: teams.find(row => row._id === team)?.teamName || (team === 'all' ? 'All teams' : 'Unassigned employees') }, period: { startDate, endDate, timezone: 'UTC' } }) : reports[0] };
    if (url.pathname === '/api/billing/production') body.report = productionBillingReport(body.report);
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await pause(100); } throw Error(`Timed out: ${code}`); }
const click = label => evaluate(`[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)}).click()`);
const select = (index, value) => evaluate(`(()=>{const node=document.querySelectorAll('.billing-filters select')[${index}];node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
async function generate() { await until(`!!document.querySelector('.billing-generate:not(:disabled)')`); const before = requests.length; await click('Generate report'); await until(`!!document.querySelector('.billing-summary-grid') && !document.querySelector('.billing-generate').disabled`); assert.ok(requests.length > before); await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`); win.webContents.invalidate(); await pause(100); }
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1400, height: 1050, webPreferences: { partition: `billing-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`); await evaluate(`localStorage.setItem('token','fixture');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});`);
    await win.loadURL(`${base}/admin/billing`); await until(`document.querySelectorAll('.billing-filters select')[0]?.value==='tax' && document.querySelectorAll('.billing-filters select')[1]?.options.length===3`);
    assert.equal(await evaluate(`document.querySelectorAll('.billing-filters select')[1].options[0].textContent`),'All members (2)');
    await generate();
    assert.equal(await evaluate(`document.querySelector('.break-card').textContent.includes('Break / Idle') && document.querySelector('.break-card strong').textContent==='0h 15m'`),true);
    assert.equal(requests.at(-1).team,'tax'); assert.equal(requests.at(-1).employee,'all');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Billing by member"] tbody').rows.length`),2);
    assert.equal(await evaluate(`document.querySelector('.billing-amount-card strong').textContent`),'$65.00');
    assert.equal(await evaluate(`[...document.querySelectorAll('.billing-project tbody tr')].every(row=>row.cells[0].textContent.includes('Member'))`),true);
    await evaluate(`document.querySelector('.billing-filters').scrollIntoView({block:'start'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(output,'team-report-desktop.png'),(await win.webContents.capturePage()).toPNG());
    const downloaded = new Promise((resolve,reject) => win.webContents.session.once('will-download', (_event,item) => {
      const target = path.join(output,path.basename(item.getFilename())); item.setSavePath(target);
      item.once('done',(_done,state)=>state==='completed'?resolve(target):reject(Error(state)));
    }));
    await click('Export Excel'); const exported = await downloaded;
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(exported);
    assert.equal(workbook.getWorksheet('Members').rowCount,3);
    assert.equal(workbook.getWorksheet('Members').getCell('E2').value,25);
    assert.equal(workbook.getWorksheet('Members').getCell('D2').value,0.25);
    assert.equal(workbook.getWorksheet('Members').getCell('E3').value,40);
    assert.equal(workbook.getWorksheet('Billing Summary').getCell('K8').value,'Ada Member');
    assert.equal(workbook.getWorksheet('Daily Details').getCell('O2').value,'Ada Member');
    await select(1,'b'); await generate();
    assert.equal(requests.at(-1).employee,'b'); assert.equal(requests.at(-1).team,undefined);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Billing by member"]')`),false);
    assert.equal(await evaluate(`document.querySelector('.billing-amount-card strong').textContent`),'$40.00');
    await select(0,'all'); await generate(); assert.equal(requests.at(-1).employee,'all');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Billing by member"] tbody').rows.length`),3);
    await select(0,'unassigned'); await generate();
    assert.equal(await evaluate(`document.querySelector('.billing-amount-card strong').textContent`),'$0.00');
    await select(0,'empty'); await generate();
    assert.equal(await evaluate(`document.querySelector('[aria-label="Billing by member"] tbody').rows.length`),0);
    win.setSize(430,900); await win.loadURL(`${base}/admin/billing`); await until(`document.querySelectorAll('.billing-filters select')[0]?.value==='tax' && document.querySelectorAll('.billing-filters select')[1]?.options.length===3 && document.querySelector('.crm-nav').getBoundingClientRect().right<1`);
    await generate(); await pause(300);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);
    fs.writeFileSync(path.join(output,'team-report-mobile.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS: Billing team/all/single/unassigned/empty reports, member rates, Excel exports and mobile. Production screens have a separate smoke suite.');
  } catch(error) { console.error(error); if(win && !win.isDestroyed()) console.error(await evaluate(`JSON.stringify({path:location.pathname,error:document.querySelector('.billing-error')?.textContent,filters:[...document.querySelectorAll('.billing-filters select')].map(node=>node.value),button:document.querySelector('.billing-generate')?.textContent})`)); process.exitCode=1; }
  finally { win?.destroy();server.closeAllConnections();server.close();app.exit(process.exitCode || 0); }
});
