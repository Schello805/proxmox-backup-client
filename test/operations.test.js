'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {parseCapacity,createCapacity}=require('../lib/capacity');
const {planSuggestions}=require('../lib/plan-suggestions');
const {createTimeline}=require('../lib/timeline');
const {validateConfig}=require('../lib/validation');
const {createBackups}=require('../lib/backups');
const {createNotifier}=require('../lib/notifier');
const {backupSummary}=require('../lib/backup-summary');
function fixture(){return validateConfig({repository:'backup@pbs@pbs:store',password:'secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false},{password:''});}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('PBS-Speicher prüft Daten, behält bei Fehlern den alten Stand und trennt Ziele',async()=>{
  const config=fixture();config.secondaryDatastore='other';let time=Date.parse('2026-10-20T10:00:00Z'),fail=false;const calls=[];
  const capacity=createCapacity({getConfig:()=>config,environment:target=>({target}),cacheFile:path.join(os.tmpdir(),'nonexistent-qnap-capacity-'+process.pid),save(){},now:()=>time,run:async(_,args,options)=>{calls.push([args,options.env.target]);if(fail)throw Error('private-secret');return{stdout:JSON.stringify({total:1000,used:options.env.target==='primary'?920:200,avail:options.env.target==='primary'?50:800})};}});
  await Promise.all([capacity.refresh('primary'),capacity.refresh('secondary'),capacity.refresh('primary')]);assert.equal(calls.length,2);assert.equal(capacity.current('primary').warning,true);assert.equal(capacity.current('secondary').warning,false);assert.equal(capacity.current('primary').available,50);assert.equal(capacity.due('primary'),false);
  time+=21*60000;fail=true;await capacity.refresh('primary');assert.equal(capacity.current('primary').stale,true);assert.equal(capacity.current('primary').used,920);assert.ok(capacity.current('primary').error);assert.ok(!JSON.stringify(capacity.all()).includes('private-secret'));assert.equal(capacity.due('primary'),false);
  config.repository='backup@pbs@different:store';assert.equal(capacity.current('primary').total,undefined);
  for(const invalid of [null,[],{total:0,used:0,avail:0},{total:100,used:-1,avail:50},{total:100,used:101,avail:0},{total:'100',used:0,avail:50}])assert.throws(()=>parseCapacity(invalid));
});
test('Zeitplanvorschlag erhält Tage, nutzt Messwerte und beseitigt bekannte Kollisionen mit Puffer',()=>{
  const config=fixture(),state={history:{}};for(const[id,time,seconds]of[['software','02:00',7200],['filme','02:30',10800]]){config.schedules[id]={days:[1,2,3,4,5,6,7],time};const source=config.sources.find(source=>source.id===id);state.history[id]=[{status:'success',path:source.path,repository:config.repository,namespace:'',durationSeconds:seconds,endedAt:'2026-10-19T10:00:00Z'}];}config.schedules.serien={days:[1],time:'03:00'};
  const now=new Date('2026-10-20T10:00:00Z'),before=JSON.stringify(config),plan=planSuggestions(config,state,now);assert.equal(plan.suggestions.length,2);assert.deepEqual(plan.unknown,['Serien']);assert.equal(JSON.stringify(config),before);
  const proposal=plan.suggestions[0];assert.equal(proposal.bufferMinutes,10);assert.deepEqual(proposal.days,config.schedules[proposal.id].days);const next={...config,schedules:{...config.schedules,[proposal.id]:{...config.schedules[proposal.id],time:proposal.time}}};assert.ok(!createTimeline(next,state,now).rows.find(row=>row.id===proposal.id).events.some(event=>event.overlap));assert.notEqual(planSuggestions(next,state,now).revision,plan.revision);
  const spring=new Date('2026-03-28T10:00:00Z');for(const proposal of planSuggestions(config,state,spring).suggestions){const preview=createTimeline({...config,schedules:{...config.schedules,[proposal.id]:{...config.schedules[proposal.id],time:proposal.time}}},state,spring);assert.equal(preview.rows.find(row=>row.id===proposal.id).events.filter(event=>event.start>=preview.start).length,7);}
});
test('Erfolgszusammenfassung ist optional, dedupliziert und enthält keine Secrets',async()=>{
  const config=fixture(),state={alerted:{}},sent=[];config.notifications={enabled:true,success:false,url:'https://ntfy.example/topic',token:'secret-token'};
  const notifier=createNotifier({getConfig:()=>config,state,persist(){},send:async(settings,message,options)=>sent.push({message,options})});
  const batch={id:'example',results:[{name:'Software',status:'success',durationSeconds:120},{name:'Filme',status:'failed',durationSeconds:60}]},message=backupSummary(batch);
  notifier.notify('summary/example',message,{success:true,warning:true});await notifier.flush();assert.equal(sent.length,0);
  config.notifications.success=true;notifier.notify('summary/example',message,{success:true,warning:true});notifier.notify('summary/example',message,{success:true});await notifier.flush();assert.equal(sent.length,1);assert.match(sent[0].message,/1 erfolgreich · 1 Fehler/);assert.match(sent[0].message,/Software: erfolgreich · 2 min/);assert.equal(sent[0].options.success,false);assert.ok(!sent[0].message.includes('secret-token'));
});
test('Warteschlange meldet nach dem letzten Auftrag genau eine Zusammenfassung auch bei Teilerfolg',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-summary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const config=fixture(),state={jobs:{}},children=[],batches=[];
  const backups=createBackups({state,data:dir,getConfig:()=>config,persist(){},inspectPath:async()=>({ok:true,mount:{}}),environment:()=>({}),log(){},archive(){},notify(){},onBatchComplete:batch=>batches.push(batch),spawnProcess:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();children.push(child);return child;}});
  backups.enqueue('software','manual');backups.enqueue('filme','manual');await tick();children[0].emit('close',0,null);await tick();assert.equal(batches.length,0);children[1].emit('close',1,null);assert.equal(batches.length,1);assert.deepEqual(batches[0].results.map(result=>result.status),['success','failed']);
  backups.enqueue('software','manual');await tick();children[2].emit('close',1,null);assert.equal(batches.length,1);
});
