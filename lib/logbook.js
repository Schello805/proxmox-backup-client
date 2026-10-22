'use strict';
const fs=require('node:fs'),path=require('node:path');
function createLogbook({getConfig,state,data,password='',getDiagnostics=()=>null,getUpdates=()=>null}){
 const valid=value=>/^[a-z][a-z0-9_-]{0,39}$/.test(value),uuid=value=>/^[a-f0-9-]{36}$/.test(value);
 const redact=value=>{let text=String(value||'');const c=getConfig();for(const secret of [password,c.password,c.secondaryPBS?.password,c.notifications?.token])if(secret)text=text.split(secret).join('[ausgeblendet]');return text;};
 function records(){
  const config=getConfig(),items=[];
  for(const sourceId of new Set([...config.sources.map(source=>source.id),...Object.keys(state.history||{})])){
   if(!valid(sourceId))continue;
   const source=config.sources.find(source=>source.id===sourceId);
   const add=(job,id,file)=>items.push({id,kind:'PBS',sourceId,sourceName:source?.name||sourceId,target:job.repository||'',status:job.status||'idle',startedAt:job.startedAt,endedAt:job.endedAt,summary:job.error||'',file});
   const job=state.jobs[sourceId];if(job && job.status!=='idle' && !(state.history?.[sourceId]||[]).some(run=>run.runId===job.runId))add(job,'pbs:'+sourceId+':current',path.join(data,sourceId+'.log'));
   for(const run of state.history?.[sourceId]||[])if(uuid(run.runId))add(run,'pbs:'+sourceId+':'+run.runId,path.join(data,'history',sourceId,run.runId+'.log'));
  }
  const drive=state.drive||{};
  for(const [index,run] of [drive,...(drive.history||[])].entries())if(run.status && run.status!=='idle')items.push({id:'drive:'+(index===0?'current':run.startedAt+':'+run.endedAt),kind:'Google Drive',sourceId:'',sourceName:run.source||'Ausgewählte Quellen',sources:[...(run.results||[]).map(result=>({id:result.id,name:result.name})),...(index===0?config.sources.filter(source=>config.gdrive?.sources.includes(source.id)).map(source=>({id:source.id,name:source.name})):[])],target:'Google Drive',status:run.status,startedAt:run.startedAt,endedAt:run.endedAt,summary:run.message||'',text:['Google Drive · '+(run.mode==='backup'?'Sicherung mit Versionen':run.mode==='sync'?'Abgleich mit Löschen':'Abgleich ohne Löschen')+' · '+run.status,run.message,...(run.results||[]).map(result=>`${result.name} → ${result.destination||''} · ${result.status}${result.verification ? ' · Zielprüfung: '+result.verification.status+' ('+result.verification.method+') · '+(result.verification.checkedAt||'')+' '+(result.verification.message||'') : ''}${result.backupDirectory?' · Alte Versionen: '+result.backupDirectory:''}`)].filter(Boolean).join('\n')+'\n\nFür Google Drive stehen Laufstatus und Quellenergebnisse zur Verfügung; keine Rclone-Rohprotokolle.'});
  if(state.notification)items.push({id:'system:notification',kind:'System',sourceId:'',sourceName:'Benachrichtigungen',target:'System',status:state.notification.ok?'success':'failed',endedAt:state.notification.at,summary:state.notification.message,text:state.notification.message});
  const diagnostics=getDiagnostics();
  if(diagnostics?.checkedAt || diagnostics?.running)items.push({id:'system:diagnostics',kind:'System',sourceId:'',sourceName:'Systemdiagnose',target:'System',status:diagnostics.running?'running':diagnostics.checks.some(check=>check.status==='error')?'failed':'success',endedAt:diagnostics.checkedAt,summary:'Letzter Diagnoselauf',text:diagnostics.checks.map(check=>`${check.status} · ${check.name}: ${check.message}`).join('\n')});
  const update=getUpdates();
  if(update)items.push({id:'system:updates',kind:'System',sourceId:'',sourceName:'Update-Prüfung',target:'System',status:update.status==='error'?'failed':'success',endedAt:update.checkedAt,summary:update.message,text:update.message});
  return items.sort((a,b)=>Number(['running','queued','cancelling'].includes(b.status))-Number(['running','queued','cancelling'].includes(a.status))||String(b.endedAt||b.startedAt||'').localeCompare(String(a.endedAt||a.startedAt||''))).slice(0,400);
 }
 return {list:()=>records().map(({file,text,...entry})=>({...entry,summary:redact(entry.summary)})),read(id){const record=records().find(entry=>entry.id===id);if(!record)throw Object.assign(new Error('Protokoll nicht vorhanden oder nicht mehr aufbewahrt.'),{status:404});let text=record.text||'Noch keine Protokollausgabe vorhanden.';if(record.file&&fs.existsSync(record.file)){const fd=fs.openSync(record.file,'r');try{const size=fs.fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,256*1024));fs.readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));text=buffer.toString('utf8');}finally{fs.closeSync(fd);}}return redact(text);}};
}
module.exports={createLogbook};
