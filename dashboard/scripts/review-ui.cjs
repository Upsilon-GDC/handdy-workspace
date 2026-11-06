const { app, BrowserWindow, session, net } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'crm-web-ui-')));
let role='admin';
const user=()=>({_id:'qa',fullName:'Review account',email:'review@example.invalid',role,isActive:true,employeeId:'REVIEW'});
const errors=[];const results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
 session.defaultSession.protocol.handle('http',async req=>{
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/'))return new Response(JSON.stringify({success:true,user:user(),employees:[],teams:[],projects:[],tasks:[],clients:[],schedules:[],shifts:[],timeLogs:[],attendance:[],totalPages:1,totalEmployees:0,idlePolicy:{idleThresholdMinutes:5,autoLogoutMinutes:30}}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
  return net.fetch(req,{bypassCustomProtocolHandlers:true});
 });
 try{
  fs.mkdirSync(path.join(root,'ui-review'),{recursive:true});
  await win.loadURL('http://127.0.0.1:5173/login');await delay(500);
  fs.writeFileSync(path.join(root,'ui-review/login.png'),(await win.webContents.capturePage()).toPNG());
  const routeSource=fs.readFileSync(path.join(root,'src/routes/AppRoutes.jsx'),'utf8');
  const inventory=[...routeSource.matchAll(/path="([^"]+)"/g)]
   .map((match)=>match[1]).filter((route)=>route!=='*')
   .map((route)=>({path:route,role:route.startsWith('/admin/')?'admin':route.startsWith('/team-lead/')?'team_lead':route.startsWith('/employee/')?'employee':null}));
  for(const item of inventory){
   if(['/admin/login','/team-lead/login'].includes(item.path))continue;
   if(!item.role&&!['/attendance','/employees','/employees/:employeeId','/profile'].includes(item.path))continue;
   role=item.role|| (item.path==='/attendance'?'hr':'admin');
   await win.webContents.executeJavaScript('localStorage.setItem("token","local-review-token");localStorage.setItem("user",'+JSON.stringify(JSON.stringify(user()))+');');
   const route=item.path.replace(':employeeId','qa');
   await win.loadURL('http://127.0.0.1:5173'+route);await delay(200);
   const state=await win.webContents.executeJavaScript('({title:document.querySelector("h1")?.textContent, shell:!!document.querySelector(".crm-workspace"), overflow:document.documentElement.scrollWidth>innerWidth+2, text:document.body.innerText.slice(0,100)})');
   results.push({route,role,...state});
   if(['/admin/dashboard','/admin/employees','/admin/settings','/admin/billing','/employee/dashboard','/employee/app','/team-lead/dashboard','/attendance'].includes(route)) fs.writeFileSync(path.join(root,'ui-review',route.slice(1).replaceAll('/','-')+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  for(const route of ['/admin/employees','/employee/dashboard','/admin/settings','/employee/app']){
   role=route.startsWith('/admin')?'admin':'employee';
   await win.webContents.executeJavaScript('localStorage.setItem("user",'+JSON.stringify(JSON.stringify(user()))+');');
   win.setSize(390,844);await win.loadURL('http://127.0.0.1:5173'+route);await delay(100);
   results.push({route,width:390,...await win.webContents.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth+2,shell:!!document.querySelector(".crm-workspace")})')});
   fs.writeFileSync(path.join(root,'ui-review',route.slice(1).replaceAll('/','-')+'-mobile.png'),(await win.webContents.capturePage()).toPNG());
  }
  role='admin';win.setSize(1440,1000);
  await win.webContents.executeJavaScript('localStorage.setItem("user",'+JSON.stringify(JSON.stringify(user()))+');');
  await win.loadURL('http://127.0.0.1:5173/admin/employees');await delay(150);
  const opened=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>/add employee/i.test(item.textContent));button?.click();return Boolean(button);})()`);
  await delay(300);
  const modalOpen=await win.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))&&document.querySelector('[role="dialog"]').contains(document.activeElement)`);
  fs.writeFileSync(path.join(root,'ui-review/employee-modal.png'),(await win.webContents.capturePage()).toPNG());
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(50);
  const modalClosed=await win.webContents.executeJavaScript(`!document.querySelector('[role="dialog"]')`);
  results.push({interaction:'employee modal',opened,focusMovedInside:modalOpen,escapeClosed:modalClosed});
  await win.loadURL('http://127.0.0.1:5173/admin/projects');await delay(200);
  const projectOpened=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>/add(?: new)? project/i.test(item.textContent));button?.click();return Boolean(button);})()`);
  await delay(300);
  const projectModalOpen=await win.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))`);
  fs.writeFileSync(path.join(root,'ui-review/project-modal.png'),(await win.webContents.capturePage()).toPNG());
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(50);
  results.push({interaction:'project modal',opened:projectOpened,dialogVisible:projectModalOpen,escapeClosed:await win.webContents.executeJavaScript(`!document.querySelector('[role="dialog"]')`)});
  // Shift Console is the only theme: its tokens apply and no theme switcher is rendered.
  const themeState=await win.webContents.executeJavaScript(`(()=>{const styles=getComputedStyle(document.documentElement);const nav=document.querySelector('.crm-nav');const primaryButton=document.querySelector('.crm-content button:not([class*="close"]):not([class*="delete"])');return {primary:styles.getPropertyValue('--primary').trim(),sidebar:styles.getPropertyValue('--sidebar-bg').trim(),navBackground:nav?getComputedStyle(nav).backgroundImage:null,buttonBackground:primaryButton?getComputedStyle(primaryButton).backgroundColor:null,switcherPresent:Boolean(document.querySelector('.theme-trigger'))};})()`);
  const themeApplied=Boolean(themeState.primary)&&!themeState.switcherPresent;
  results.push({interaction:'shift console theme',themeApplied,themeState});
  fs.writeFileSync(path.join(root,'ui-review/results.json'),JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({routes:results.filter(x=>x.route).length,routeFailures:results.filter(x=>x.route&&(!x.shell||x.overflow)),interactions:results.filter(x=>x.interaction),errors:errors.slice(0,8)},null,2));
 }catch(e){console.error(e);process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
});
