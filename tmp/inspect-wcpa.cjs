const path = require('node:path');
const base = path.resolve('backend');
require(path.join(base,'node_modules/dotenv')).config({path:path.join(base,'.env'),quiet:true});
const {MongoClient}=require(path.join(base,'node_modules/mongoose')).mongo;
const id=x=>String(x||'');
async function main(){
 if(process.env.MONGODB_DNS_SERVERS) require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(x=>x.trim()));
 const c=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:2,serverSelectionTimeoutMS:15000,connectTimeoutMS:15000});
 try{
 await c.connect(); const db=c.db();
 const teams=await db.collection('teams').find({teamName:/wcpa/i},{projection:{teamName:1,isActive:1},maxTimeMS:15000}).toArray();
 const projects=await db.collection('projects').find({projectName:/^\s*no\s+project\s*$/i},{projection:{projectName:1,teams:1,status:1,deletedAt:1,clients:1,client:1,activityMappingEnabled:1,linkedTasks:1},maxTimeMS:15000}).toArray();
 const tids=teams.map(t=>t._id), pids=projects.map(p=>p._id);
 const tasks=await db.collection('tasks').find({$or:[{team:{$in:tids}},{teams:{$in:tids}}]},{projection:{taskName:1,taskCode:1,project:1,isActive:1,deletedAt:1},maxTimeMS:15000}).toArray();
 const maps=await db.collection('activity_mappings').find({project:{$in:pids},task:{$in:tasks.map(t=>t._id)}},{projection:{project:1,client:1,task:1,isActive:1},maxTimeMS:15000}).toArray();
 const clients=await db.collection('clients').find({_id:{$in:[...maps.map(m=>m.client),...projects.flatMap(p=>[...(p.clients||[]),p.client].filter(Boolean))]}},{projection:{clientName:1,status:1},maxTimeMS:15000}).toArray();
 const tb=new Map(tasks.map(t=>[id(t._id),t])), cb=new Map(clients.map(c=>[id(c._id),c]));
 console.log(JSON.stringify({teams,projects:projects.map(p=>({...p,clients:[...new Set([...(p.clients||[]),p.client].filter(Boolean).map(id))].map(x=>cb.get(x)),wcpaTeamIncluded:!(p.teams||[]).length||(p.teams||[]).some(x=>tids.some(y=>id(x)===id(y)))})),links:maps.filter(m=>m.isActive===true&&projects.some(p=>id(p._id)===id(m.project)&&p.status==='Active'&&!p.deletedAt)).map(m=>({client:cb.get(id(m.client))?.clientName,clientActive:cb.get(id(m.client))?.status==='Active',task:tb.get(id(m.task))?.taskName,code:tb.get(id(m.task))?.taskCode,taskActive:tb.get(id(m.task))?.isActive===true&&!tb.get(id(m.task))?.deletedAt})),inactiveLinkCount:maps.filter(m=>m.isActive!==true).length,legacyTasks:tasks.filter(t=>t.isActive===true&&!t.deletedAt&&(!t.project||pids.some(p=>id(p)===id(t.project)))).map(t=>({name:t.taskName,code:t.taskCode,shared:!t.project}))},null,2));
 }finally{await c.close();}
}
main().catch(e=>{console.error('Read-only inspection failed: '+(e.code||e.name));process.exitCode=1;});
