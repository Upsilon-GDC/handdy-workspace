const path=require('node:path'),fs=require('node:fs'),Module=require('node:module');
const requireDesktop=Module.createRequire(path.resolve(__dirname,'../../desktop-app/package.json'));
const {app,BrowserWindow}=requireDesktop('electron');
app.whenReady().then(async()=>{
 let win;
 try{
  win=new BrowserWindow({show:false,width:1100,height:1200,webPreferences:{backgroundThrottling:false}});
  await win.loadFile(path.resolve(__dirname,'report.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');
  const layout=await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.page')).map((p,i)=>({page:i+1,height:p.clientHeight,scroll:p.scrollHeight,lastContent:Math.max(...Array.from(p.children).filter(n=>n.tagName!=='FOOTER').map(n=>n.getBoundingClientRect().bottom-p.getBoundingClientRect().top)),footer:p.querySelector('footer').getBoundingClientRect().top-p.getBoundingClientRect().top}))`);
  fs.writeFileSync(path.resolve(__dirname,'layout.json'),JSON.stringify(layout,null,2));
  const bad=layout.filter(p=>p.lastContent>p.footer-10);
  if(bad.length)throw Error('Content overlaps footer: '+JSON.stringify(bad));
  const pdf=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'A4',margins:{top:0,bottom:0,left:0,right:0}});
  fs.writeFileSync(path.resolve(__dirname,'../../output/pdf/CRM_UI_Audit_and_Comparison_Report.pdf'),pdf);
  console.log('PDF generated; '+layout.length+' layout checks passed.');
 }catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}
});
