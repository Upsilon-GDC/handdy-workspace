const path=require('node:path'),base=path.resolve('backend');
require(path.join(base,'node_modules/dotenv')).config({path:path.join(base,'.env'),quiet:true});
const mongoose=require(path.join(base,'node_modules/mongoose'));
mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
const Employee=require(path.join(base,'src/models/Employee'));
const Team=require(path.join(base,'src/models/Team'));
const Project=require(path.join(base,'src/models/Project'));
const Policy=require(path.join(base,'src/models/ClientAccessPolicy'));
const access=require(path.join(base,'src/services/clientAccess'));
const {activityOptionsForEmployee}=require(path.join(base,'src/services/activitySelection'));
async function main(){
 if(process.env.MONGODB_DNS_SERVERS)require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(x=>x.trim()));
 try{
 await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false,maxPoolSize:2,serverSelectionTimeoutMS:15000});
 const employees=await Employee.find({$or:[{fullName:/bhargav/i},{firstName:/bhargav/i}]}).select('_id fullName employeeId role team isActive').lean();
 access.replacePolicies(await Policy.find({}).lean());
 const projects=await Project.find({projectName:/^\s*no\s+project\s*$/i,status:'Active',deletedAt:null}).lean();
 for(const employee of employees){
 const team=employee.team?await Team.findById(employee.team).select('teamName').lean():null;
 const options=[];for(const project of projects){const result=await activityOptionsForEmployee(project,employee);options.push({project:project.projectName,...result});}
 console.log(JSON.stringify({employee:{name:employee.fullName,employeeId:employee.employeeId,role:employee.role,active:employee.isActive,team:team?.teamName},options},null,2));
 }
 if(!employees.length)console.log('No employee named Bhargav found.');
 }finally{await mongoose.disconnect();}
}
main().catch(e=>{console.error('Read-only inspection failed: '+(e.code||e.name));process.exitCode=1;});
