'use strict';
const crypto = require('node:crypto');
const { targetsFor } = require('./targets');
function createPartitions({getConfig, inspectPath, run, apply, getSourceSize = () => null}) {
  async function list(id) {
    const config=getConfig(), source=config.sources.find(item=>item.id===id);
    if (!source || source.parentId) throw new Error('Eine Hauptquelle auswählen.');
    const mount=await inspectPath(source.path,source.expectedSource);
    if (!mount.ok || !source.expectedSource) throw new Error(mount.error || 'Zuerst die Mount-Quelle bestätigen.');
    const script="const fs=require('fs');const p=process.argv[1];if(fs.realpathSync(p)!==p)throw Error('Symlink');const entries=fs.readdirSync(p,{withFileTypes:true});if(entries.length>2000)throw Error('Too many entries');process.stdout.write(JSON.stringify({folders:entries.filter(e=>e.isDirectory()).map(e=>e.name),otherEntries:entries.filter(e=>!e.isDirectory()).length}));";
    const {stdout}=await run(process.execPath,['-e',script,source.path],{timeout:8000,maxBuffer:1024*1024});
    const data=JSON.parse(stdout);
    if (!Array.isArray(data.folders) || data.folders.length>290 || !Number.isInteger(data.otherEntries)) throw new Error('Zu viele oder ungültige Unterordner (maximal 290).');
    for(const folder of data.folders) if(typeof folder!=='string'||!folder||/[\r\n\0:/]/.test(folder)||['.','..'].includes(folder)) throw new Error('Nicht unterstützter Ordnername.');
    const after=await inspectPath(source.path,source.expectedSource);
    if(!after.ok || JSON.stringify(after.mount)!==JSON.stringify(mount.mount)) throw new Error('Mount während der Abfrage geändert.');
    const children=config.sources.filter(item=>item.parentId===id);
    return {source:{id:source.id,name:source.name,path:source.path,partitioned:Boolean(source.partitioned),expectedSource:source.expectedSource},otherEntries:data.otherEntries,folders:data.folders.sort((a,b)=>a.localeCompare(b,'de')).map(name=>({name,target:children.find(item=>item.path===source.path+'/'+name)?.target||'',id:children.find(item=>item.path===source.path+'/'+name)?.id||null,bytes:getSourceSize({...children.find(item=>item.path===source.path+'/'+name),mount:after.mount})?.bytes??null})),targets:targetsFor(config)};
  }
  async function save(id,mapping) {
    const listing=await list(id),config=getConfig(),parent=config.sources.find(item=>item.id===id);
    if(!parent || parent.path!==listing.source.path || parent.expectedSource!==listing.source.expectedSource)throw new Error('Quelle wurde zwischenzeitlich geändert. Unterordner neu laden.');
    if(listing.otherEntries)throw new Error('Im Hauptverzeichnis liegen Dateien oder Verknüpfungen. Diese zuerst in Unterordner einordnen; sonst wären sie nicht Teil der Aufträge.');
    if(!listing.folders.length)throw new Error('Keine Unterordner zum Aufteilen vorhanden.');
    if(!Array.isArray(mapping)||mapping.length!==listing.folders.length||new Set(mapping.map(item=>item?.folder)).size!==mapping.length)throw new Error('Alle aktuellen Unterordner genau einmal zuordnen.');
    const configured=listing.targets.filter(item=>item.repository&&item.hasPassword);
    const children=listing.folders.map(folder=>{
      const assignment=mapping.find(item=>item?.folder===folder.name);
      if(!assignment||!configured.some(target=>target.id===assignment.target))throw new Error('Für jeden Unterordner ein eingerichtetes PBS-Ziel wählen.');
      const old=config.sources.find(item=>item.parentId===id&&item.path===parent.path+'/'+folder.name);
      return {id:old?.id||id.slice(0,10)+'-'+(folder.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').slice(0,14)||'ordner')+'-'+crypto.createHash('sha256').update(id+'\0'+folder.name).digest('hex').slice(0,10),name:old?.name||(parent.name+' · '+folder.name).slice(0,60),path:parent.path+'/'+folder.name,expectedSource:parent.expectedSource,target:assignment.target,parentId:id};
    });
    const remaining=config.sources.filter(item=>item.parentId!==id);
    const sources=remaining.map(item=>item.id===id?{...item,partitioned:true,partitionSchedule:item.partitionSchedule||config.schedules[id]||''}:item).concat(children);
    const schedules={...config.schedules,[id]:''};
    for(const child of children)schedules[child.id]=config.schedules[child.id]||parent.partitionSchedule||config.schedules[id]||'';
    apply({...config,sources,schedules,gdrive:{...config.gdrive,sources:config.gdrive.sources.filter(sourceId=>sources.some(item=>item.id===sourceId))}});
    return {success:true,created:children.length};
  }
  function restore(id){
    const config=getConfig(),parent=config.sources.find(item=>item.id===id);
    if(!parent?.partitioned)throw new Error('Quelle ist nicht aufgeteilt.');
    const sources=config.sources.filter(item=>item.parentId!==id).map(item=>{if(item.id!==id)return item;const {partitioned,...rest}=item;return rest;});
    apply({...config,sources,schedules:{...config.schedules,[id]:''},gdrive:{...config.gdrive,sources:config.gdrive.sources.filter(sourceId=>sources.some(item=>item.id===sourceId))}});
    return {success:true};
  }
  return {list,save,restore};
}
module.exports={createPartitions};
