const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const original = path.join(root, 'desktop-app/test/dashboard-lifecycle-smoke.cjs');
let source = fs.readFileSync(original, 'utf8').split('app.whenReady().then(async () => {')[0];
source = source.replace('endpoint.startsWith("/time-logs/") ? 6500 : 150', '100');
source = source.replace('      res.end(JSON.stringify(body));\n    },', `
      if (endpoint === '/clients') body = { clients: [{_id:'c1',clientName:'WCPA',status:'Active'}, {_id:'c2',clientName:'Renau CPA',status:'Active'}] };
      if (endpoint === '/projects') body = { projects: [{_id:'p1',projectCode:'PRJ-AUDIT',projectName:'Audit',clients:[{_id:'c1',clientName:'WCPA'}],clientName:'WCPA',teams:[{_id:'team',teamName:'Stable team'}],status:'Active'}, {_id:'p2',projectCode:'PRJ-TAX',projectName:'Tax Preparation',clientName:'Renau CPA',teams:[{_id:'team',teamName:'Stable team'}],status:'Active'}],totalPages:1 };
      if (endpoint === '/tasks') body = { tasks: [{_id:'t1',taskCode:'TSK-REVIEW',taskName:'Tax Review',taskType:'work',project:{_id:'p2',projectName:'Tax Preparation'},teams:[{_id:'team',teamName:'Stable team'}],assignToAllEmployees:true,assignedTo:[],isActive:true}],totalPages:1 };
      if (endpoint === '/settings/idle-policy') body = { idlePolicy:{idleThresholdMinutes:5,autoLogoutMinutes:50} };
      res.end(JSON.stringify(body));
    },`);
source += `app.whenReady().then(async () => {
  const output = path.resolve(${JSON.stringify(root)}, 'tmp/ui-audit/screens'); fs.mkdirSync(output,{recursive:true});
  const measurements=[];
  try {
    auditRegressionMode=true; await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{partition:'audit-'+Date.now(),backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
    await win.loadURL(base+'/login');
    await evaluate('localStorage.setItem("token","fixture");localStorage.setItem("user",'+JSON.stringify(JSON.stringify(user))+');localStorage.setItem("app-theme","upsilon");');
    const capture=async(name)=>{ await delay(200); await evaluate('document.documentElement.style.scrollBehavior="auto";window.scrollTo({top:0,behavior:"instant"})'); await delay(100); fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG()); };
    for(const [name,route,wait] of [
      ['employees','/admin/employees','document.querySelectorAll("tbody tr").length>5'],
      ['projects','/admin/projects','document.body.textContent.includes("Tax Preparation")'],
      ['clients','/admin/clients','document.body.textContent.includes("Renau CPA")'],
      ['tasks','/admin/tasks','document.body.textContent.includes("Tax Review")'],
      ['teams','/admin/team','document.body.textContent.includes("Stable team")'],
      ['idle-settings','/admin/settings','!!document.querySelector("input[type=number]")'],
    ]) {
      console.log('Reviewing '+name); await win.loadURL(base+route); await until(wait); await capture(name);
      measurements.push({name,route,...await evaluate('({viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,smallText:[...document.querySelectorAll("main small,main label,main th,.crm-nav a")].slice(0,80).map(n=>({tag:n.tagName,size:getComputedStyle(n).fontSize})),primaryActions:[...document.querySelectorAll("main button")].slice(0,12).map(n=>({text:n.textContent.trim(),height:Math.round(n.getBoundingClientRect().height)}))})')});
      if(name==='employees'||name==='projects') {
        const needle=name==='employees'?'Add Employee':'Add New Project';
        await evaluate('[...document.querySelectorAll("button")].find(n=>n.textContent.toLowerCase().includes('+JSON.stringify(needle.toLowerCase())+')).click()');
        await until('!!document.querySelector(".employee-modal")'); await capture(name+'-modal');
      }
    }
    win.setSize(520,900);await win.loadURL(base+'/admin/employees');await until('document.querySelectorAll("tbody tr").length>5');await capture('employees-mobile');
    fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify(measurements,null,2));
    console.log('Captured current build with synthetic data: '+measurements.length+' admin modules plus forms and mobile.');
  } catch(error) { console.error(error);process.exitCode=1; }
  finally {win?.destroy();server.close();app.exit(process.exitCode||0);}
});`;
const compiled = new Module(original, module); compiled.filename=original; compiled.paths=Module._nodeModulePaths(path.dirname(original)); compiled._compile(source,original);
