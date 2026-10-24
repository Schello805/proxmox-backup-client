'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateConfig}=require('../lib/validation');
const {createBackups}=require('../lib/backups');
const {createScheduler}=require('../lib/scheduler');
const {repositoryFor}=require('../lib/targets');
test('Reine Drive-Quellen werden validiert und niemals als PBS-Auftrag eingereiht',()=>{
 const config=validateConfig({repository:'backup@pbs@pbs:store',password:'secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false},{password:''});
 config.sources=config.sources.map(source=>({...source,target:'gdrive'}));
 const validated=validateConfig(config,config);assert.equal(validated.sources[0].target,'gdrive');assert.equal(repositoryFor(validated,'gdrive'),'');
 const state={jobs:{},watchSince:{},triggered:{}};
 const backups=createBackups({state,getConfig:()=>validated,persist(){},isMaintenance:()=>false});
 assert.throws(()=>backups.enqueue(config.sources[0].id,'manual'),/Google-Drive-Auftrag/);
 const batch=backups.enqueueAll();assert.deepEqual(batch.added,[]);
 let attempts=0;for(const source of validated.sources)validated.schedules[source.id]={days:[1,2,3,4,5,6,7],time:'12:00'};
 const scheduler=createScheduler({getConfig:()=>validated,state,persist(){},backups:{enqueue(){attempts++;}},notify(){},log(){},clock:()=>new Date('2026-10-24T10:00:00Z')});scheduler.tick();assert.equal(attempts,0);
});
