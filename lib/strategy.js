'use strict';
const crypto = require('node:crypto');
const { normalizeSchedule, scheduleKey, matchesDay, occurrence, scheduleWindow } = require('./planning');
const { lastDuration } = require('./timeline');
const { targetsFor } = require('./targets');
const kinds = ['locations','sources','targets','datasets','software','networks','plans'];
function empty() { return {format:1,version:'backup-control-strategy',data:Object.fromEntries(kinds.map(key=>[key,[]])),mapping:{datasets:{},targets:{}}}; }
function fail(message) { throw Object.assign(new Error(message), {status:400}); }
function text(value, max=500, required=false) { if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('Ungültiger Text in der Strategie.');const out=value.trim();if(required&&!out)fail('Name oder Kennung fehlt.');return out; }
function id(value) { const result=text(value,100,true);if(!/^[a-zA-Z0-9_-]+$/.test(result)||['__proto__','constructor','prototype'].includes(result))fail('Ungültige Strategie-Kennung.');return result; }
function normalize(document) {
 if(!document||document.format!==1||!document.data||typeof document.data!=='object'||Array.isArray(document.data))fail('Keine unterstützte Backup-Planner-Datei (Format 1).');
 const out=empty(),warnings=[];
 out.version=typeof document.version==='string'?text(document.version,80):'unbekannt';
 for(const key of kinds){
  const rows=document.data[key]??[];if(!Array.isArray(rows)||rows.length>2000)fail('Zu viele oder ungültige Einträge: '+key);
  const ids=new Set();let skipped=0;
  out.data[key]=rows.flatMap(row=>{
   if(!row||typeof row!=='object'||Array.isArray(row))fail('Ungültiger Strategie-Eintrag.');
   if(row.deleted_at||row.active===0||row.active===false){skipped++;return [];}
   const identifier=id(row.id);if(ids.has(identifier))fail('Doppelte Kennung: '+identifier);ids.add(identifier);
   const clean={id:identifier,name:text(row.name,160,true),notes:text(row.notes??'',4000),active:1};
   for(const field of {locations:['parent_id','type'],sources:['location_id','device_type'],targets:['location_id','device_id','storage_type','provider'],datasets:['source_id','priority'],software:[],networks:[],plans:['source_id','source_target_id','target_id','software_id','protection_type']}[key]){
    const value=row[field];clean[field]=value==null||value===''?null:text(value,160);
   }
   if(key==='targets'||key==='plans')clean.color=typeof row.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(row.color)?row.color:'#3978ed';
   if(key==='targets'){clean.immutable_capable=row.immutable_capable?1:0;clean.encrypted_default=row.encrypted_default?1:0;}
   if(key==='datasets'&&!['low','normal','high'].includes(clean.priority))clean.priority='normal';
   if(key==='networks'){const value=row.capacity_mib??null;if(value!==null&&(!Number.isFinite(value)||value<=0||value>100000))fail('Netzkapazität muss positiv sein (MiB/s).');clean.capacity_mib=value;}
   if(key==='plans'){
    clean.implementation=row.implementation??'planned';if(!['planned','external','app'].includes(clean.implementation))fail('Unbekannter Umsetzungsstand.');
    clean.executor=text(row.executor??'',160);if(clean.implementation==='external'&&!clean.executor)fail('Für extern eingerichtete Sicherungen das ausführende System angeben.');
    clean.network_id=row.network_id? id(row.network_id):null;
    const bandwidth=row.bandwidth_mib??null;if(bandwidth!==null&&(!Number.isFinite(bandwidth)||bandwidth<=0||bandwidth>100000))fail('Erwartete Bandbreite muss positiv sein (MiB/s).');clean.bandwidth_mib=bandwidth;
    if(!['backup','synchronization','archive'].includes(clean.protection_type))fail('Unbekannte Schutzart im Plan '+clean.name);
    const scheduleType=row.schedule_type??'manual';if(!['daily','weekly','monthly','manual'].includes(scheduleType))fail('Unbekannter Zeitplantyp.');
    const schedule=normalizeSchedule({days:scheduleType==='daily'?[1,2,3,4,5,6,7]:scheduleType==='weekly'?row.weekdays:[],time:scheduleType==='manual'?'':row.start_time,...(scheduleType==='monthly'?{monthDay:row.day_of_month}: {})});
    if(scheduleType==='weekly'&&!schedule.days.length)fail('Wöchentlicher Plan braucht mindestens einen Tag.');
    clean.schedule_type=scheduleType;clean.weekdays=schedule.days;clean.start_time=schedule.time;clean.day_of_month=schedule.monthDay??1;
    const duration=row.duration_minutes??0;if(!Number.isFinite(duration)||duration<0||duration>525600)fail('Ungültige geplante Dauer.');clean.duration_minutes=duration;
    if(!Array.isArray(row.dataset_ids)||!row.dataset_ids.length||row.dataset_ids.length>2000||new Set(row.dataset_ids).size!==row.dataset_ids.length)fail('Ungültige Datenbestände im Plan.');clean.dataset_ids=row.dataset_ids.map(id);
    clean.encrypted=row.encrypted?1:0;clean.immutable=row.immutable?1:0;
    const retention=row.retention_value??null;if(retention!==null&&(!Number.isFinite(retention)||retention<0||retention>1000000))fail('Ungültige Aufbewahrung.');clean.retention_value=retention;clean.retention_unit=text(row.retention_unit??'days',30);clean.owner=text(row.owner??'',160);
    clean.version_count=Number.isInteger(row.version_count)&&row.version_count>=0?Math.min(row.version_count,100000):0;
   }
   return [clean];
  });
  if(skipped)warnings.push(`${skipped} inaktive/gelöschte Einträge aus ${key} bleiben ausgeschlossen.`);
 }
 const has=(key,value)=>!value||out.data[key].some(row=>row.id===value);
 for(const location of out.data.locations){if(!has('locations',location.parent_id))fail('Übergeordneter Standort fehlt.');const seen=new Set([location.id]);let parent=location.parent_id;while(parent){if(seen.has(parent))fail('Zyklische Standorthierarchie.');seen.add(parent);parent=out.data.locations.find(row=>row.id===parent)?.parent_id;}}
 for(const row of [...out.data.sources,...out.data.targets])if(!has('locations',row.location_id))fail('Standort einer Quelle oder eines Ziels fehlt.');
 for(const target of out.data.targets)if(!has('sources',target.device_id))fail('Gerät des Speicherziels fehlt.');
 for(const row of out.data.datasets)if(!row.source_id||!has('sources',row.source_id))fail('Ursprung eines Datenbestands fehlt.');
 for(const row of out.data.plans){
  if(!has('networks',row.network_id))fail('Netzwerkbereich des Plans fehlt.');
  if(!row.source_id||!row.target_id||!has('sources',row.source_id)||!has('targets',row.target_id)||!has('targets',row.source_target_id)||!has('software',row.software_id)||row.dataset_ids.some(value=>!has('datasets',value)))fail('Plan verweist auf einen fehlenden oder inaktiven Eintrag: '+row.name);
  if(row.source_target_id===row.target_id)fail('Quelle und Ziel des externen Plans sind identisch.');
  if(row.source_target_id&&!out.data.plans.some(upstream=>upstream.target_id===row.source_target_id&&upstream.source_id===row.source_id&&row.dataset_ids.every(value=>upstream.dataset_ids.includes(value))))warnings.push('Vorgelagerte Kopie für „'+row.name+'“ ist nicht vollständig dokumentiert.');
  if(row.dataset_ids.some(value=>out.data.datasets.find(item=>item.id===value).source_id!==row.source_id))fail('Datenbestand passt nicht zum Ursprung des Plans: '+row.name);
 }
 return {document:out,warnings};
}
function validateMapping(mapping,document,config){
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))fail('Zuordnung fehlt.');
 const out={datasets:{},targets:{}};
 const localTargets=[...targetsFor(config).filter(target=>target.repository).map(target=>target.id),'gdrive'];
 for(const key of ['datasets','targets']){
  const values=mapping[key]??{};if(!values||typeof values!=='object'||Array.isArray(values))fail('Ungültige Zuordnung.');
  for(const [from,to]of Object.entries(values)){
   if(!document.data[key].some(item=>item.id===from))fail('Unbekannter Planner-Eintrag in Zuordnung.');
   if(!to)continue;
   if(typeof to!=='string'||!(key==='datasets'?config.sources.some(source=>source.id===to):localTargets.includes(to)))fail('Zugeordnete App-Quelle oder Ziel existiert nicht mehr.');
   out[key][from]=to;
  }
 }
 for(const [key,valid]of [['devices',config.sources.map(source=>source.id)],['targetDevices',localTargets]]){
  const entries=mapping[key]??{};if(!entries||typeof entries!=='object'||Array.isArray(entries))fail('Ungültige Gerätezuordnung.');
  for(const [from,to]of Object.entries(entries)){if(!valid.includes(from))continue;if(!to)continue;if(typeof to!=='string'||!document.data.sources.some(device=>device.id===to))fail('Zugeordnetes Gerät existiert nicht.');(out[key]??={})[from]=to;}
 }
 return out;
}
function revision(document){return crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');}
function scheduleFor(plan){return normalizeSchedule({days:plan.schedule_type==='daily'?[1,2,3,4,5,6,7]:plan.schedule_type==='weekly'?plan.weekdays:[],time:plan.schedule_type==='manual'?'':plan.start_time,...(plan.schedule_type==='monthly'?{monthDay:plan.day_of_month}:{})});}
function liveJobs(config,state,drive={}){
 const targets=targetsFor(config),jobs=[];
 for(const source of config.sources.filter(source=>!source.partitioned&&source.target!=='gdrive')){
  const duration=lastDuration(source,config,state),job=state.jobs?.[source.id]||{};
  jobs.push({id:'pbs:'+source.id,name:source.name,source:source.name,sourceId:source.id,rootId:source.parentId||source.id,target:targets.find(target=>target.id===(source.target||'primary'))?.name||'PBS',targetId:source.target||'primary',engine:'pbs',implementation:'app',executor:'Backup Control',configured:Boolean(targets.find(target=>target.id===(source.target||'primary'))?.hasPassword&&targets.find(target=>target.id===(source.target||'primary'))?.repository),resources:[],networks:[],protection:'backup',schedule:config.schedules[source.id],seconds:duration?.seconds??null,durationKind:duration?'measured':'unknown',status:job.status||'idle',lastSuccess:job.lastSuccess||null,verification:job.verification?.status||null,edit:'#jobs/'+source.id+'/edit'});
 }
 if(config.gdrive.sources.length){
  const seconds=Number.isFinite(drive.durationSeconds)?drive.durationSeconds:drive.status==='success'&&drive.startedAt&&drive.endedAt?(Date.parse(drive.endedAt)-Date.parse(drive.startedAt))/1000:null;
  jobs.push({id:'gdrive',name:'Google Drive',source:config.sources.filter(source=>config.gdrive.sources.includes(source.id)).map(source=>source.name).join(', '),sourceIds:config.gdrive.sources,target:'Google Drive',targetId:'gdrive',engine:'gdrive',implementation:'app',executor:'Backup Control',configured:true,resources:[],networks:[],protection:config.gdrive.mode==='backup'?'backup':'synchronization',schedule:config.gdrive.schedule,seconds:Number.isFinite(seconds)&&seconds>=0?seconds:null,durationKind:seconds!=null?'measured':'unknown',status:drive.status||'idle',lastSuccess:drive.lastSuccess||null,verification:drive.verification?.status||null,edit:'#targets'});
 }
 return jobs;
}
function strategyView(document,config,state,drive,now=new Date(),anchor=null){
 if(anchor && (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||!Number.isFinite(Date.parse(anchor+'T12:00:00Z'))||new Date(anchor+'T12:00:00Z').toISOString().slice(0,10)!==anchor))fail('Ungültiger Kalenderzeitraum.');
 const jobs=liveJobs(config,state,drive),mapping=document.mapping||{datasets:{},targets:{}},validBindings=[];
 const targetResources=id=>{const target=targetsFor(config).find(target=>target.id===mapping.targets[id]);return ['target:'+id,...(document.data.targets.find(item=>item.id===id)?.device_id?['device:'+document.data.targets.find(item=>item.id===id).device_id]:[]),...(target?.repository?['pbs:'+target.repository.slice(target.repository.lastIndexOf('@')+1,target.repository.lastIndexOf(':'))]:[]),...(mapping.targets[id]==='gdrive'?['cloud:gdrive']:[])];};
 const external=document.data.plans.map(plan=>{
  const source=document.data.sources.find(item=>item.id===plan.source_id),upstream=document.data.targets.find(item=>item.id===plan.source_target_id),target=document.data.targets.find(item=>item.id===plan.target_id);
  const {bindings,fullyLinked}=planBindings(plan,document,config,jobs);
  validBindings.push(...bindings);
  return {id:'external:'+plan.id,planId:plan.id,name:plan.name,source:upstream?.name||source.name,target:target.name,targetId:plan.target_id,engine:'external',implementation:plan.implementation||'planned',executor:plan.executor||'',configured:plan.implementation==='external',networkId:plan.network_id,bandwidthMiB:plan.bandwidth_mib,resources:[...(plan.source_target_id?targetResources(plan.source_target_id):['device:'+plan.source_id]),...targetResources(plan.target_id)],networks:plan.network_id?[{id:plan.network_id,rate:plan.bandwidth_mib}]:[],protection:plan.protection_type,schedule:scheduleFor(plan),seconds:plan.duration_minutes>0?plan.duration_minutes*60:null,durationKind:plan.duration_minutes>0?'planned':'unknown',status:'unverified',lastSuccess:null,bindings,fullyLinked,executionReady:plan.implementation==='external'||plan.implementation==='app'&&fullyLinked,edit:'#strategy/plan/'+plan.id,datasetNames:plan.dataset_ids.map(id=>document.data.datasets.find(row=>row.id===id).name)};
 });
 for(const source of config.sources){
  const job=jobs.find(job=>job.sourceId===source.id);if(!job)continue;
  const host=source.expectedSource?.startsWith('//')?source.expectedSource.split('/')[2]:source.expectedSource?.split(':/')[0];if(host)job.resources.push('nas:'+host);
  const repo=targetsFor(config).find(target=>target.id===(source.target||'primary'))?.repository;if(repo)job.resources.push('pbs:'+repo.slice(repo.lastIndexOf('@')+1,repo.lastIndexOf(':')));
 }
 for(const job of jobs){
  if(job.engine==='gdrive')job.resources.push('cloud:gdrive');
  const source=config.sources.find(source=>source.id===job.sourceId),deviceId=document.mapping.devices?.[job.sourceId]||document.mapping.devices?.[source?.parentId];job.sourceDeviceId=deviceId||null;if(deviceId)job.resources.push('device:'+deviceId);
  if(document.mapping.targetDevices?.[job.targetId])job.resources.push('device:'+document.mapping.targetDevices[job.targetId]);
  for(const target of document.data.targets)if(mapping.targets[target.id]===job.targetId)job.resources.push(...targetResources(target.id));
  for(const dataset of document.data.datasets)if(!job.sourceDeviceId&&mapping.datasets[dataset.id]&&[job.sourceId,job.rootId,...(job.sourceIds||[])].includes(mapping.datasets[dataset.id]))job.resources.push('device:'+dataset.source_id);
  job.resources=[...new Set(job.resources)];
 }
 for(const plan of document.data.plans.filter(plan=>plan.implementation==='app')){
  const entry=external.find(item=>item.planId===plan.id);if(!entry.fullyLinked)continue;
  for(const job of jobs.filter(job=>entry.bindings.includes(job.id))){
   job.resources=[...new Set([...job.resources,...(job.sourceDeviceId?[]:plan.source_target_id?targetResources(plan.source_target_id):['device:'+plan.source_id]),...targetResources(plan.target_id)])];
   if(plan.network_id){const network=job.networks.find(item=>item.id===plan.network_id);if(network)network.rate=Math.max(network.rate||0,plan.bandwidth_mib||0)||null;else job.networks.push({id:plan.network_id,rate:plan.bandwidth_mib});}
  }
  entry.appSchedules=jobs.filter(job=>entry.bindings.includes(job.id)).map(job=>({id:job.id,name:job.name,schedule:job.schedule,edit:job.edit}));
 }
 const today=anchor||scheduleKey(now,config.timezone).day,day=new Date(today+'T12:00:00Z'),days=Array.from({length:8},(_,i)=>{const date=new Date(day);date.setUTCDate(day.getUTCDate()+i);const key=date.toISOString().slice(0,10);return {day:key,start:occurrence(key,'00:00',config.timezone)};});
 const events=[];let truncated=false;
 for(const job of [...jobs,...external]){
  job.nextAt=scheduleWindow(job.schedule,config.timezone,now).nextAt;
  // Include earlier starts when a known long run crosses into the visible week.
  const lookback=job.seconds==null?0:Math.min(366,Math.ceil(job.seconds/86400));
  for(let offset=-lookback;offset<7;offset++){
   if(events.length>=20000){truncated=true;break;}
   const date=new Date(day);date.setUTCDate(day.getUTCDate()+offset);const key=date.toISOString().slice(0,10);if(!matchesDay(job.schedule,key))continue;
   const start=occurrence(key,job.schedule.time,config.timezone);if(start==null)continue;
   const end=job.seconds==null?null:start+job.seconds*1000;
   if(start>=days[7].start||end!=null&&end<=days[0].start||end==null&&start<days[0].start)continue;
   events.push({jobId:job.id,start,end});
  }
 }
 const operating=[...jobs,...external.filter(job=>job.implementation==='external')];
 const analysis=require('./network-planning').analyze({jobs:operating,events,networks:document.data.networks||[],resources:document.data,start:days[0].start,end:days[7].start});
 const planningAnalysis=require('./network-planning').analyze({jobs:[...jobs,...external.filter(job=>job.implementation!=='app')],events,networks:document.data.networks||[],resources:document.data,start:days[0].start,end:days[7].start});
 const catalog=buildCatalog(document,config,jobs,external);
 return {...catalog,analysis,planningAnalysis,truncated,jobs,external,events,days:days.slice(0,7).map((row,i)=>({...row,end:days[i+1].start})),timezone:config.timezone,now:now.getTime(),linkedJobs:[...new Set(validBindings)].length};
}

function planBindings(plan,document,config,jobs){
 const mapping=document.mapping||{datasets:{},targets:{}};
 const bindings=jobs.filter(job=>job.targetId===mapping.targets[plan.target_id]&&plan.dataset_ids.some(dataset=>job.engine==='pbs'?[job.rootId,job.sourceId].includes(mapping.datasets[dataset]):job.sourceIds.includes(mapping.datasets[dataset]))).map(job=>job.id);
 const fullyLinked=plan.dataset_ids.every(dataset=>{
  const localId=mapping.datasets[dataset],targetId=mapping.targets[plan.target_id];if(!localId||!targetId)return false;
  const source=config.sources.find(item=>item.id===localId);if(!source)return false;
  const parts=source.partitioned?config.sources.filter(item=>item.parentId===localId):[source];
  return parts.length>0&&parts.every(item=>jobs.some(job=>job.configured&&job.protection===plan.protection_type&&job.targetId===targetId&&(job.engine==='gdrive'?job.sourceIds.includes(localId):job.sourceId===item.id)));
 });
 return {bindings,fullyLinked};
}
function validateImplementation(document,config,state,drive){
 const jobs=liveJobs(config,state,drive);
 for(const plan of document.data.plans)if(plan.implementation==='app'&&!planBindings(plan,document,config,jobs).fullyLinked)fail('App-Umsetzung: Datenbestand und Ziel vollständig einem passenden eingerichteten App-Auftrag zuordnen.');
}
function buildCatalog(document,config,jobs,external){
 const byPlan=new Map(document.data.plans.map(plan=>[plan.id,plan])),byDataset=new Map();
 for(const entry of external)for(const dataset of byPlan.get(entry.planId).dataset_ids){if(!byDataset.has(dataset))byDataset.set(dataset,[]);byDataset.get(dataset).push(entry);}
 const device=id=>document.data.sources.find(item=>item.id===id);
 const sourceDevice=source=>document.mapping.devices?.[source.id]||document.mapping.devices?.[source.parentId]||null;
 const targetDevice=id=>{const direct=document.mapping.targetDevices?.[id];if(direct)return direct;const ids=[...new Set(document.data.targets.filter(target=>document.mapping.targets[target.id]===id&&target.device_id).map(target=>target.device_id))];return ids.length===1?ids[0]:null;};
 const sources=config.sources.map(source=>{
  const datasets=document.data.datasets.filter(dataset=>document.mapping.datasets[dataset.id]===source.id);
  const related=[...new Set(datasets.flatMap(dataset=>byDataset.get(dataset.id)||[]))];
  return {id:'app:'+source.id,appSourceId:source.id,deviceId:sourceDevice(source),device:device(sourceDevice(source))?.name||null,name:source.name,path:source.path,datasetIds:datasets.map(dataset=>dataset.id),plans:related.map(plan=>plan.planId),states:[...new Set([...jobs.filter(job=>job.configured&&(job.rootId===source.id||job.sourceId===source.id||job.sourceIds?.includes(source.id))).map(()=> 'app'),...related.map(plan=>plan.implementation==='app'&&!plan.executionReady?'planned':plan.implementation)])]};
 });
 for(const dataset of document.data.datasets){if(sources.some(source=>source.datasetIds?.includes(dataset.id)))continue;const related=byDataset.get(dataset.id)||[];sources.push({id:'dataset:'+dataset.id,datasetId:dataset.id,name:dataset.name,deviceId:dataset.source_id,device:device(dataset.source_id)?.name,path:null,plans:related.map(plan=>plan.planId),states:related.length?[...new Set(related.map(plan=>plan.implementation==='app'&&!plan.executionReady?'planned':plan.implementation))]:['planned']});}
 const targets=targetsFor(config).filter(target=>target.repository).map(target=>({id:'app:'+target.id,appTargetId:target.id,deviceId:targetDevice(target.id),device:device(targetDevice(target.id))?.name||null,name:target.name,states:['app'],planIds:document.data.plans.filter(plan=>document.mapping.targets[plan.target_id]===target.id).map(plan=>plan.id)}));
 if(config.gdrive.sources.length)targets.push({id:'app:gdrive',appTargetId:'gdrive',deviceId:targetDevice('gdrive'),device:device(targetDevice('gdrive'))?.name||null,name:'Google Drive',states:['app'],planIds:document.data.plans.filter(plan=>document.mapping.targets[plan.target_id]==='gdrive').map(plan=>plan.id)});
 for(const target of document.data.targets){if(document.mapping.targets[target.id]&&targets.some(item=>item.appTargetId===document.mapping.targets[target.id]))continue;const plans=document.data.plans.filter(plan=>plan.target_id===target.id);targets.push({id:'target:'+target.id,targetId:target.id,deviceId:target.device_id||null,device:device(target.device_id)?.name||null,name:target.name,states:[...new Set(plans.map(plan=>plan.implementation||'planned'))],planIds:plans.map(plan=>plan.id)});}
 return {catalogSources:sources,catalogTargets:targets};
}

module.exports={validateImplementation,planBindings,empty,normalize,validateMapping,revision,strategyView,scheduleFor,liveJobs};
