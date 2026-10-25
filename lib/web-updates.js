'use strict';
const fs=require('node:fs'),path=require('node:path');
const active=new Set(['queued','running']);
function createWebUpdates({data,updates,isBusy,run,statusFile='/run/qnap-backup-update/status.json',enabled,now=Date.now}){
 const request=path.join(data,'update-request');let starting=false,available=null,checked=0;
 async function supported(){
  if(enabled)return enabled();
  if(data!=='/var/lib/qnap-backup')return false;
  if(available===true&&now()-checked<10000)return available;
  try{const result=await run('systemctl',['is-active','qnap-backup-update.path'],{timeout:3000,maxBuffer:4096});available=result.stdout.trim()==='active';}catch{available=false;}
  checked=now();return available;
 }
 function current(){
  try{const info=fs.lstatSync(request);if(info.isFile())return {phase:now()-info.mtimeMs>60000?'failed':'queued',message:now()-info.mtimeMs>60000?'Update-Helfer hat nicht reagiert. Systemdienst qnap-backup-update.path prüfen.':'Update wird vorbereitet …',startedAt:info.mtime.toISOString()};}catch{}
  try{const state=JSON.parse(fs.readFileSync(statusFile,'utf8'));if(['running','succeeded','failed'].includes(state.phase)&&Number.isFinite(Date.parse(state.startedAt))){if(state.phase==='running'&&now()-Date.parse(state.startedAt)>35*60000)return {phase:'failed',message:'Update-Zeitlimit überschritten. Systemdienst und Update-Protokoll prüfen.',startedAt:state.startedAt};return {phase:state.phase,startedAt:state.startedAt,endedAt:state.endedAt||null,message:state.phase==='running'?'Update läuft. Der Dienst wird kurz neu gestartet.':state.phase==='succeeded'?'Update abgeschlossen.':'Update fehlgeschlagen. Protokoll: journalctl -u qnap-backup-update --no-pager'};}}catch{}
  return {phase:'idle',message:'Noch kein Update über die App gestartet.'};
 }
 function pending(){return starting||fs.existsSync(request)||active.has(current().phase);}
 async function status(){return {...current(),supported:await supported()};}
 async function start(input){
  const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
  if(input?.confirm!==true)fail('Update-Installation bitte bestätigen.',400);
  if(pending())fail('Ein Update läuft bereits oder wartet.');starting=true;
  try{
   if(!await supported())fail('Web-Update einmalig aktivieren: deploy/enable-web-updates.sh im LXC als root ausführen. Danach Browser neu laden.');
   if(isBusy())fail('Ein Backup oder eine Systemabfrage läuft bzw. wartet. Nach Abschluss erneut versuchen.');
   const candidate=await updates.check();if(candidate.status!=='available')fail(candidate.message||'Kein installierbares Update bestätigt.');
   if(isBusy())fail('Ein Backup oder eine Systemabfrage wurde gestartet. Nach Abschluss erneut versuchen.');
   fs.writeFileSync(request,'update\n',{flag:'wx',mode:0o600});return {...current(),supported:true};
  }finally{starting=false;}
 }
 return {status,start,pending,current};
}
module.exports={createWebUpdates};
