'use strict';
const crypto = require('node:crypto');
const { targetsFor } = require('./targets');
const {validEntryName} = require('./file-selection');
const listingScript = `const fs=require('fs'),path=require('path');const p=process.argv[1];if(fs.realpathSync(p)!==p)throw Error('Symlink');const entries=fs.readdirSync(p,{withFileTypes:true});if(entries.length>5000)throw Error('Too many entries');process.stdout.write(JSON.stringify({folders:entries.filter(e=>e.isDirectory()).map(e=>e.name),files:entries.filter(e=>!e.isDirectory()).map(e=>{const stat=fs.lstatSync(path.join(p,e.name));return {name:e.name,kind:stat.isFile()?'file':stat.isSymbolicLink()?'symlink':'other',bytes:stat.isFile()?stat.size:null,mtimeMs:stat.mtimeMs};}),otherEntries:entries.filter(e=>!e.isDirectory()).length}));`;
function createPartitions({getConfig, inspectPath, run, apply, getSourceSize = () => null, planAutomatic = null, saveLedger = () => {}}) {
  async function list(id) {
    const config=getConfig(), source=config.sources.find(item=>item.id===id);
    if (!source || source.parentId) throw new Error('Eine Hauptquelle auswählen.');
    const mount=await inspectPath(source.path,source.expectedSource);
    if (!mount.ok || !source.expectedSource) throw new Error(mount.error || 'Zuerst die Mount-Quelle bestätigen.');
    const {stdout}=await run(process.execPath,['-e',listingScript,source.path],{timeout:30000,maxBuffer:4*1024*1024});
    const data=JSON.parse(stdout), files=data.files||[];
    if (!Array.isArray(data.folders) || data.folders.length>290 || !Number.isInteger(data.otherEntries) || !Array.isArray(files) || data.folders.length+files.length>5000) throw new Error('Zu viele Einträge: maximal 290 Ordner und insgesamt 5000 Einträge.');
    for(const name of [...data.folders,...files.map(item=>item.name)]) if(!validEntryName(name)) throw new Error('Nicht unterstützter Datei- oder Ordnername.');
    for(const item of files)if(!['file','symlink','other'].includes(item.kind)||item.kind==='file'&&(!Number.isSafeInteger(item.bytes)||item.bytes<0))throw new Error('Ungültige Dateimetadaten.');
    const after=await inspectPath(source.path,source.expectedSource);
    if(!after.ok || JSON.stringify(after.mount)!==JSON.stringify(mount.mount)) throw new Error('Mount während der Abfrage geändert.');
    const children=config.sources.filter(item=>item.parentId===id), skipped=new Set(source.partitionSkipped||[]);
    return {source:{id:source.id,name:source.name,path:source.path,partitioned:Boolean(source.partitioned),autoPartition:source.autoPartition||null,expectedSource:source.expectedSource},mount:after.mount,otherEntries:data.otherEntries,
      folders:data.folders.sort((a,b)=>a.localeCompare(b,'de')).map(name=>{const child=children.find(item=>!item.selection&&item.path===source.path+'/'+name);return {name,target:skipped.has(name)?'skip':child?.target||'',id:child?.id||null,bytes:child?getSourceSize({...child,mount:after.mount})?.bytes??null:null};}),
      files:files.sort((a,b)=>a.name.localeCompare(b.name,'de')).map(item=>({...item,target:skipped.has(item.name)?'skip':children.find(child=>child.selection?.includes(item.name))?.target||''})),targets:targetsFor(config)};
  }
  async function save(id,mapping,fileMapping,autoPartition) {
    const listing=await list(id),config=getConfig(),parent=config.sources.find(item=>item.id===id);
    if(!parent || parent.path!==listing.source.path || parent.expectedSource!==listing.source.expectedSource)throw new Error('Quelle wurde zwischenzeitlich geändert. Aufteilung neu laden.');
    if(listing.otherEntries!==listing.files.length)throw new Error('Dateien im Hauptverzeichnis konnten nicht vollständig gelesen werden. Neu laden.');
    if(!listing.folders.length&&!listing.files.length&&!autoPartition)throw new Error('Keine Einträge zum Aufteilen vorhanden.');
    const policy=require('./auto-partitions').validateAutoPartition(autoPartition);
    let automatic;
    if(policy){if(!planAutomatic)throw Error('Automatische Verteilung nicht verfügbar.');const folders=listing.folders.map(item=>({...item,target:mapping?.find(value=>value.folder===item.name)?.target||''}));automatic=await planAutomatic(id,policy,(fileMapping||[]).filter(item=>item.target),{...listing,folders});fileMapping=automatic.files;}
    const configured=listing.targets.filter(item=>item.repository&&item.hasPassword),skipped=[];
    function validateAssignments(entries,assignments,key){
      if(!Array.isArray(assignments)||assignments.length!==entries.length||new Set(assignments.map(item=>item?.[key])).size!==assignments.length)throw new Error('Alle aktuellen Dateien und Ordner genau einmal zuordnen oder ausdrücklich auslassen.');
      return entries.map(entry=>{const assignment=assignments.find(item=>item?.[key]===entry.name);if(!assignment||assignment.target!=='skip'&&!configured.some(target=>target.id===assignment.target))throw new Error('Für jeden Eintrag ein eingerichtetes PBS-Ziel wählen oder ausdrücklich auslassen.');if(entry.kind&&entry.kind!=='file'&&assignment.target!=='skip')throw new Error('Verknüpfungen und Spezialdateien können hier nur ausdrücklich ausgelassen werden.');if(assignment.target==='skip')skipped.push(entry.name);return {...entry,target:assignment.target};});
    }
    const folders=validateAssignments(listing.folders,mapping,'folder'),files=validateAssignments(listing.files,fileMapping||[],'name');
    if(files.some(item=>item.target!=='skip')&&listing.files.some(item=>item.name==='.pxarexclude'))throw new Error('.pxarexclude in der Quelle kann die Dateiauswahl überschreiben. Datei-Aufteilung gesperrt.');
    const children=folders.filter(folder=>folder.target!=='skip').map(folder=>{
      const old=config.sources.find(item=>item.parentId===id&&!item.selection&&item.path===parent.path+'/'+folder.name);
      return {id:old?.id||id.slice(0,10)+'-'+(folder.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').slice(0,14)||'ordner')+'-'+crypto.createHash('sha256').update(id+'\0'+folder.name).digest('hex').slice(0,10),name:old?.name||(parent.name+' · '+folder.name).slice(0,60),path:parent.path+'/'+folder.name,expectedSource:parent.expectedSource,target:folder.target,parentId:id};
    });
    const folderJobs=children.length;
    for(const target of configured){const selected=files.filter(item=>item.target===target.id).map(item=>item.name);if(!selected.length&&!policy?.targets.some(item=>item.id===target.id))continue;const old=config.sources.find(item=>item.parentId===id&&item.selection&&item.target===target.id);children.push({id:old?.id||id.slice(0,20)+'-files-'+target.id,name:old?.name||(parent.name+' · Dateien · '+target.name).slice(0,60),path:parent.path,expectedSource:parent.expectedSource,target:target.id,parentId:id,selection:selected});}
    if(!children.length)throw new Error('Mindestens einen Sicherungsauftrag zuordnen.');
    const remaining=config.sources.filter(item=>item.parentId!==id);
    const sources=remaining.map(item=>item.id===id?{...item,autoPartition:policy,partitioned:true,partitionSkipped:skipped,partitionSchedule:item.partitionSchedule||config.schedules[id]||''}:item).concat(children);
    const schedules={...config.schedules,[id]:''};
    for(const child of children)schedules[child.id]=config.schedules[child.id]||parent.partitionSchedule||config.schedules[id]||'';
    apply({...config,sources,schedules,gdrive:{...config.gdrive,sources:config.gdrive.sources.filter(sourceId=>sources.some(item=>item.id===sourceId&&!item.selection))}});
    if(policy)saveLedger(id,automatic.ledger);
    return {success:true,created:children.length,folderJobs,fileJobs:children.length-folderJobs,skipped:skipped.length};
  }
  function restore(id){
    const config=getConfig(),parent=config.sources.find(item=>item.id===id);
    if(!parent?.partitioned)throw new Error('Quelle ist nicht aufgeteilt.');
    const sources=config.sources.filter(item=>item.parentId!==id).map(item=>{if(item.id!==id)return item;const {partitioned,partitionSkipped,autoPartition,...rest}=item;return rest;});
    apply({...config,sources,schedules:{...config.schedules,[id]:''},gdrive:{...config.gdrive,sources:config.gdrive.sources.filter(sourceId=>sources.some(item=>item.id===sourceId))}});
    return {success:true};
  }
  return {list,save,restore};
}
module.exports={createPartitions};
