'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPartitions}=require('../lib/partitions');
const {validateConfig}=require('../lib/validation');
const {repositoryFor,targetConfig,targetsFor}=require('../lib/targets');
function fixture(){
 let config=validateConfig({...require('../config.example.json'),repository:'root@pam@pbs:pbs1',password:'secret',secondaryDatastore:'pbs2',additionalDatastores:[{id:'extra1',datastore:'pbs3'},{id:'extra2',datastore:'pbs4'}],sources:[{id:'filme',name:'Filme',path:'/mnt/Daten/Filme',expectedSource:'nas:/Filme',target:'secondary'}],schedules:{filme:{days:[1],time:'02:00'}}},{password:''});
 let entries={folders:['Film A','Film B'],otherEntries:0};
 const mounts={type:'nfs4',source:'nas:/Filme',target:'/mnt/Daten/Filme'};
 const service=createPartitions({getConfig:()=>config,inspectPath:async()=>({ok:true,mount:mounts}),run:async()=>({stdout:JSON.stringify(entries)}),apply:input=>{config=validateConfig(input,config);}});
 return {service,get config(){return config;},setEntries(value){entries=value;}};
}
test('Vier Datastores teilen Zugang und Fingerprint von PBS 1, behalten stabile IDs und erlauben keine Duplikate',()=>{
 const f=fixture();assert.equal(targetsFor(f.config).length,4);assert.equal(repositoryFor(f.config,'extra1'),'root@pam@pbs:pbs3');assert.equal(targetConfig(f.config,'extra2').password,'secret');
 assert.throws(()=>validateConfig({...f.config,additionalDatastores:[{id:'extra1',datastore:'pbs2'}]},f.config));
 assert.throws(()=>validateConfig({...f.config,sources:[{...f.config.sources[0],target:'extra3'}]},f.config));
});
test('Unterordner erhalten feste, disjunkte PBS-Aufträge mit geerbtem Plan; Hauptquelle bleibt nur als Übersicht erhalten',async()=>{
 const f=fixture();const map=[{folder:'Film A',target:'secondary'},{folder:'Film B',target:'extra1'}];
 await f.service.save('filme',map);assert.equal(f.config.sources.length,3);assert.equal(f.config.sources[0].partitioned,true);assert.deepEqual(f.config.schedules.filme.days,[]);
 const children=f.config.sources.filter(item=>item.parentId==='filme');assert.equal(children[0].path,'/mnt/Daten/Filme/Film A');assert.equal(children[1].target,'extra1');assert.deepEqual(f.config.schedules[children[0].id].days,[1]);
 const firstId=children[0].id;await f.service.save('filme',map);assert.equal(f.config.sources.find(item=>item.path.endsWith('/Film A')).id,firstId);
 f.service.restore('filme');assert.equal(f.config.sources.length,1);assert.equal(f.config.sources[0].partitioned,undefined);
});
test('Unvollständige, doppelte oder veraltete Zuordnung und Dateien im Hauptordner werden abgewiesen',async()=>{
 const f=fixture();for(const mapping of [[{folder:'Film A',target:'secondary'}],[{folder:'Film A',target:'secondary'},{folder:'Film A',target:'extra1'}],[{folder:'Film A',target:'secondary'},{folder:'Film X',target:'extra1'}],[{folder:'Film A',target:'secondary'},{folder:'Film B',target:'extra9'}]])await assert.rejects(f.service.save('filme',mapping));
 assert.equal(f.config.sources.length,1);f.setEntries({folders:['Film A'],otherEntries:1});await assert.rejects(f.service.save('filme',[{folder:'Film A',target:'secondary'}]),/Hauptverzeichnis/);
});
test('Normale überlappende Quellen bleiben verboten; Teilquelle ohne bestätigte Hauptquelle ebenfalls',()=>{
 const f=fixture();const child={id:'child',name:'Kind',path:'/mnt/Daten/Filme/Film A',expectedSource:'nas:/Filme',target:'extra1'};
 assert.throws(()=>validateConfig({...f.config,sources:[...f.config.sources,child]},f.config));assert.throws(()=>validateConfig({...f.config,sources:[{...child,parentId:'filme'}]},f.config));
});
test('Neue Unterordner benötigen Zuordnung und übernehmen den ursprünglichen Plan auch nach erneuter Aufteilung',async()=>{
 const f=fixture();const map=[{folder:'Film A',target:'secondary'},{folder:'Film B',target:'extra1'}];
 await f.service.save('filme',map);f.setEntries({folders:['Film A','Film B','Film C'],otherEntries:0});
 const listing=await f.service.list('filme');assert.equal(listing.folders.find(item=>item.name==='Film C').target,'');
 await assert.rejects(f.service.save('filme',map));
 await f.service.save('filme',[...map,{folder:'Film C',target:'extra1'}]);
 const added=f.config.sources.find(item=>item.path.endsWith('/Film C'));assert.deepEqual(f.config.schedules[added.id].days,[1]);
});
test('Alle sichern überspringt die aufgeteilte Hauptquelle und reiht nur ihre Teilaufträge ein',async t=>{
 const f=fixture();await f.service.save('filme',[{folder:'Film A',target:'secondary'},{folder:'Film B',target:'extra1'}]);
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pbs-partitions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {createBackups}=require('../lib/backups');const backups=createBackups({getConfig:()=>f.config,state:{jobs:{}},data:dir,persist(){},inspectPath(){},environment(){},log(){},archive(){},notify(){},isBlocked:()=>true});
 assert.throws(()=>backups.enqueue('filme','manual'),/aufgeteilt/);
 const batch=backups.enqueueAll();assert.equal(batch.added.length,2);assert.equal(backups.queue.includes('filme'),false);
});
test('PBS-Bestand und Speicherquoten der zusätzlichen Datastores werden getrennt abgefragt und gecacht',async()=>{
 const f=fixture(),{createPBS}=require('../lib/pbs'),{createCapacity}=require('../lib/capacity');
 const saves=[];const environment=target=>targetConfig(f.config,target);
 const pbs=createPBS({getConfig:()=>f.config,environment,cacheFile:'/tmp/no-partition-cache-'+Date.now(),save:(file)=>saves.push(file),run:async(_,args,{env})=>({stdout:JSON.stringify([{'backup-type':'host','backup-id':env.repository.split(':').at(-1),'backup-time':1792454400,files:[]}])})});
 await Promise.all([pbs.refresh('extra1'),pbs.refresh('extra2')]);
 assert.equal(pbs.current('extra1').snapshots[0].id,'pbs3');assert.equal(pbs.current('extra2').snapshots[0].id,'pbs4');assert.notEqual(saves[0],saves[1]);
 const capacity=createCapacity({getConfig:()=>f.config,environment,cacheFile:'/tmp/no-capacity-cache-'+Date.now(),save(){},run:async(_,args,{env})=>({stdout:JSON.stringify({total:1000,used:env.repository.endsWith(':pbs3')?300:400,avail:500})})});
 await Promise.all([capacity.refresh('extra1'),capacity.refresh('extra2')]);assert.equal(capacity.current('extra1').used,300);assert.equal(capacity.current('extra2').used,400);
});
