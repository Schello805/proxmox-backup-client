'use strict';
const {targetsFor,targetConfig}=require('./targets');
const {selectionKey}=require('./file-selection');
function validateAutoPartition(value){
 if(value==null)return null;
 if(!value||!Array.isArray(value.targets)||value.targets.length<2||value.targets.length>20||new Set(value.targets.map(item=>item?.id)).size!==value.targets.length)throw Error('Automatische Verteilung benötigt mindestens zwei unterschiedliche Ziele.');
 return {targets:value.targets.map(item=>{if(!item||!['primary','secondary'].includes(item.id)&&!/^extra[1-9][0-9]?$/.test(item.id)||!Number.isInteger(item.maxPercent)||item.maxPercent<1||item.maxPercent>99)throw Error('Belegungsgrenze je Ziel: 1 bis 99 Prozent.');return {id:item.id,maxPercent:item.maxPercent};})};
}
const signature=file=>JSON.stringify([file.bytes,file.mtimeMs??null]);
// Reserve uncompressed input plus metadata headroom. PBS compression/deduplication
// are deliberately not assumed when placing files on a datastore.
const reservation=file=>Math.ceil(file.bytes*1.02)+65536;
function planFiles({files,assignments,policy,capacities,previous=[],identities={},repositories={},reservedElsewhere={},labels={}}){
 const placed=new Map(assignments.map(item=>[item.name,item.target])),limits=new Map(),pending=new Map(policy.targets.map(item=>[item.id,reservedElsewhere[item.id]||0]));
 for(const target of policy.targets){const c=capacities[target.id];if(!c||c.error||c.stale||!Number.isSafeInteger(c.total)||!Number.isSafeInteger(c.used)||!Number.isSafeInteger(c.available)||c.total<=0||c.used<0||c.available<0||!c.checkedAt)throw Error('Aktueller Speicherstand für '+(labels[target.id]||target.id)+' fehlt. Verteilung gestoppt.');limits.set(target.id,Math.max(0,Math.min(c.available,Math.floor(c.total*target.maxPercent/100)-c.used)));}
 const ledger=[];
 for(const file of files){const target=placed.get(file.name);if(target==='skip')continue;if(file.kind!=='file')throw Error('Neuer Ordner, Verweis oder Spezialdatei: unter Quellen ausdrücklich zuordnen oder auslassen.');if(target){if(!pending.has(target))throw Error('Dateiziel fehlt in der automatischen Zielreihenfolge.');const old=previous.find(item=>item.name===file.name&&item.target===target&&item.signature===signature(file)&&item.scope===(identities[target]||''));const uploaded=Boolean(old?.uploaded);ledger.push({name:file.name,target,bytes:file.bytes,scope:identities[target]||'',repository:repositories[target]||'',signature:signature(file),uploaded});if(!uploaded)pending.set(target,pending.get(target)+reservation(file));}}
 for(const target of policy.targets)if(pending.get(target.id)>limits.get(target.id))throw Error('Belegungsgrenze '+target.maxPercent+' % für '+(labels[target.id]||target.id)+' reicht für bereits zugeordnete, noch zu sichernde Dateien nicht aus. Grenze/Platz unter Quellen prüfen.');
 const availability=policy.targets.map(target=>(labels[target.id]||target.id)+': '+new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(Math.max(0,limits.get(target.id)-pending.get(target.id))/1024**3)+' GiB bis '+target.maxPercent+' % ('+Math.round(capacities[target.id].used/capacities[target.id].total*1000)/10+' % belegt)').join('; ');
 for(const file of files.filter(item=>!placed.get(item.name)).sort((a,b)=>b.bytes-a.bytes||a.name.localeCompare(b.name,'de'))){const target=policy.targets.find(item=>limits.get(item.id)-pending.get(item.id)>=reservation(file));if(!target)throw Error('Kein Ziel hat Platz innerhalb der Belegungsgrenzen für '+file.name+'. Vor der Verteilung verfügbar: '+availability+'. Keine neue Zuordnung gespeichert. Weiteres Ziel wählen oder Speicher freigeben.');placed.set(file.name,target.id);pending.set(target.id,pending.get(target.id)+reservation(file));ledger.push({name:file.name,target:target.id,bytes:file.bytes,scope:identities[target.id]||'',repository:repositories[target.id]||'',signature:signature(file),uploaded:false});}
 return {files:files.map(file=>({name:file.name,target:placed.get(file.name)})),ledger,estimates:policy.targets.map(target=>({id:target.id,maxPercent:target.maxPercent,usedPercent:Math.round(capacities[target.id].used/capacities[target.id].total*1000)/10,projectedPercent:Math.round((capacities[target.id].used+pending.get(target.id))/capacities[target.id].total*1000)/10}))};
}
function createAutoPartitions({getConfig,list,capacity,updateSelections,state,persist}){
 state.autoFiles ||= {};
 async function plan(id,policy,assignments,listing,{preview=false}={}){
  if(!policy)throw Error('Automatische Verteilung zuerst einrichten.');
  const config=getConfig(),parent=config.sources.find(item=>item.id===id);listing||=await list(id);
  if(!parent)throw Error('Quelle fehlt.');
  if(listing.files.some(item=>item.name==='.pxarexclude'))throw Error('.pxarexclude verhindert die automatische Dateiauswahl.');
  const unassignedFolders=listing.folders.filter(item=>!item.target).map(item=>item.name);
  if(unassignedFolders.length&&!preview)throw Error('Diese Ordner noch zuordnen oder bewusst auslassen: '+unassignedFolders.join(', ')+'.');
  const targets=targetsFor(config);for(const target of policy.targets)if(!targets.some(item=>item.id===target.id&&item.repository&&item.hasPassword))throw Error('Automatisches PBS-Ziel ist nicht vollständig eingerichtet.');
  const capacities={};for(const target of policy.targets)capacities[target.id]=await capacity.refresh(target.id);
  const identities={},repositories={},reservedElsewhere={};
  for(const target of policy.targets){const connection=targetConfig(config,target.id);identities[target.id]=JSON.stringify([parent.path,parent.expectedSource,connection.repository,connection.namespace]);repositories[target.id]=connection.repository;reservedElsewhere[target.id]=0;for(const other of config.sources.filter(item=>item.autoPartition&&item.id!==id)){for(const entry of state.autoFiles[other.id]||[]){if(!entry.uploaded&&entry.repository===connection.repository&&Number.isSafeInteger(entry.bytes)&&other.autoPartition.targets.some(item=>item.id===entry.target)&&entry.scope===JSON.stringify([other.path,other.expectedSource,targetConfig(config,entry.target).repository,targetConfig(config,entry.target).namespace]))reservedElsewhere[target.id]+=reservation(entry);}}}
  const previous=[...(state.autoFiles[id]||[])];
  // A successful manual file job can establish existing coverage when enabling
  // automation. Only the exact archive scope and files unchanged since its start qualify.
  for(const child of config.sources.filter(item=>item.parentId===id&&item.selection)){const connection=targetConfig(config,child.target),records=[...(state.history?.[child.id]||[]),state.jobs?.[child.id]].filter(Boolean);const success=records.filter(record=>record.status==='success'&&record.path===child.path&&record.repository===connection.repository&&(record.namespace||'')===(connection.namespace||'')&&record.selectionKey===selectionKey(child)&&Number.isFinite(Date.parse(record.startedAt))).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];if(!success)continue;for(const file of listing.files.filter(item=>child.selection.includes(item.name)&&Number.isFinite(item.mtimeMs)&&item.mtimeMs<=Date.parse(success.startedAt))){if(!previous.some(item=>item.name===file.name&&item.target===child.target&&item.scope===identities[child.target]&&item.signature===signature(file)))previous.push({name:file.name,target:child.target,bytes:file.bytes,scope:identities[child.target],signature:signature(file),uploaded:true});}}
  const result=planFiles({files:listing.files,assignments,policy,capacities,previous,identities,repositories,reservedElsewhere,labels:Object.fromEntries(targets.map(item=>[item.id,item.name]))});return {...result,capacities,unassignedFolders};
 }
 async function prepare(source,isCurrent){
  const config=getConfig(),parent=config.sources.find(item=>item.id===source.parentId);if(!source.selection||!parent?.autoPartition)return source;
  const listing=await list(parent.id),assignments=listing.files.filter(item=>item.target).map(item=>({name:item.name,target:item.target}));
  const result=await plan(parent.id,parent.autoPartition,assignments,listing);
  if(!isCurrent()||getConfig()!==config)throw Error('Verteilung abgebrochen oder Konfiguration geändert.');
  const groups=config.sources.filter(item=>item.parentId===parent.id&&item.selection),selections=new Map(groups.map(group=>[group.id,result.files.filter(item=>item.target===group.target).map(item=>item.name)]));
  updateSelections(parent.id,selections);state.autoFiles[parent.id]=result.ledger;persist();return getConfig().sources.find(item=>item.id===source.id);
 }
 async function check(source){const parent=getConfig().sources.find(item=>item.id===source.parentId),limit=parent?.autoPartition?.targets.find(item=>item.id===source.target);if(!limit)return;const current=await capacity.refresh(source.target);if(current.error||!current.checkedAt)throw Error('Speichergrenze kann nicht geprüft werden. Sicherung gestoppt.');if(current.used/current.total*100>=limit.maxPercent)throw Error('Belegungsgrenze '+limit.maxPercent+' % für '+(targetsFor(getConfig()).find(item=>item.id===source.target)?.name||source.target)+' erreicht. Sicherung gestoppt.');}
 function succeeded(source){if(!getConfig().sources.find(item=>item.id===source.parentId)?.autoPartition)return;for(const item of state.autoFiles[source.parentId]||[])if(item.target===source.target&&source.selection.includes(item.name))item.uploaded=true;persist();}
 return {plan,prepare,check,succeeded};
}
module.exports={validateAutoPartition,planFiles,createAutoPartitions};
