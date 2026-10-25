'use strict';
// Root helper: fixed paths and command only. Never read commands or arguments from the request.
const fs=require('node:fs'),{spawn}=require('node:child_process');
async function performUpdate({request='/var/lib/qnap-backup/update-request',directory='/run/qnap-backup-update',execute=()=>new Promise((resolve,reject)=>{
 const child=spawn('/bin/sh',['/opt/proxmox-backup-client/deploy/update.sh'],{cwd:'/opt/proxmox-backup-client',env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root'},stdio:['ignore','inherit','inherit']});child.once('error',reject);child.once('close',code=>resolve(code));
}),now=()=>new Date().toISOString()}={}){
 let info;try{info=fs.lstatSync(request);}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(!info.isFile()){fs.unlinkSync(request);throw Error('Ungültige Update-Anforderung.');}
 fs.mkdirSync(directory,{recursive:true,mode:0o755});const startedAt=now();
 const status=(phase)=>{const file=directory+'/status.json',temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify({phase,startedAt,endedAt:phase==='running'?null:now()}),{mode:0o644});fs.renameSync(temporary,file);};
 status('running');fs.unlinkSync(request);
 try{const code=await execute();status(code===0?'succeeded':'failed');return code;}catch(error){status('failed');throw error;}
}
if(require.main===module)performUpdate().then(code=>{if(code!==undefined&&code!==0)process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={performUpdate};
