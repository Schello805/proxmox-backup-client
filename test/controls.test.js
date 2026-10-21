'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateConfig}=require('../lib/validation');
const {validatePolicy,inWindow,rateArgs}=require('../lib/backup-policy');
const {exportConfig,previewRestore,revision}=require('../lib/config-backup');
const {compareRuns}=require('../lib/run-comparison');
const {createConfigService}=require('../lib/config-service');
const {migrateConfig}=require('../lib/storage');
function config(){return {...validateConfig({repository:'user@pbs@pbs:store',password:'primary-secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false,notifications:{enabled:true,url:'https://ntfy.example/topic',token:'ntfy-secret'}},{password:''}),schemaVersion:4};}
test('Start windows honor timezone, midnight, exclusive end and DST; default is unrestricted',()=>{
 const c=config();assert.equal(inWindow(c,new Date()),true);c.backupPolicy={windowEnabled:true,start:'22:00',end:'06:00',rateMiB:10};
 for(const[date,expected]of[['2026-10-20T20:00:00Z',true],['2026-10-21T03:59:00Z',true],['2026-10-21T04:00:00Z',false],['2026-10-21T12:00:00Z',false],['2026-10-25T00:30:00Z',true],['2026-10-25T01:30:00Z',true]])assert.equal(inWindow(c,new Date(date)),expected,date);
 c.backupPolicy.start='08:00';c.backupPolicy.end='18:00';assert.equal(inWindow(c,new Date('2026-10-21T12:00:00Z')),true);assert.deepEqual(rateArgs(c),['--rate','10485760','--burst','10485760']);
 for(const value of [{rateMiB:-1},{rateMiB:1.2},{rateMiB:'10'},{driveRateMiB:-1},{driveRateMiB:1.5},{driveRateMiB:'10'},{windowEnabled:true,start:'22:00',end:'22:00'},{start:'25:00'}])assert.throws(()=>validatePolicy(value));
});
test('Export redacts secrets by default, explicit export includes them and preview does not mutate config',()=>{
 const c=config();c.secondaryDatastore='other';c.secondaryPBS={server:'pbs2.local',authId:'other@pbs',password:'secondary-secret',fingerprint:'',namespace:''};const original=JSON.stringify(c);
 const safe=exportConfig(c);assert.ok(!JSON.stringify(safe).includes('primary-secret'));assert.ok(!JSON.stringify(safe).includes('secondary-secret'));assert.ok(!JSON.stringify(safe).includes('ntfy-secret'));
 assert.equal(exportConfig(c,true).config.secondaryPBS.password,'secondary-secret');assert.throws(()=>exportConfig(c,'true'));
 safe.config.timezone='UTC';const preview=previewRestore(safe,c);assert.equal(preview.candidate.password,c.password);assert.equal(preview.candidate.secondaryPBS.password,'secondary-secret');assert.equal(preview.candidate.notifications.token,'ntfy-secret');assert.ok(preview.summary.changes.includes('Zeitzone'));assert.equal(preview.summary.includesSecrets,false);assert.equal(JSON.stringify(c),original);assert.equal(preview.summary.revision,revision(c));
 const empty=config();empty.repository='';empty.password='';const restored=previewRestore(safe,empty);assert.equal(restored.candidate.password,'');assert.equal(restored.candidate.secondaryPBS.password,'');assert.equal(restored.summary.warnings.length,2);assert.equal(migrateConfig(restored.candidate,'').secondaryPBS.password,'');
 const other=exportConfig(c);other.config.repository='user@pbs@other:store';other.config.secondaryPBS.server='new.local';const changed=previewRestore(other,c);assert.equal(changed.candidate.password,'');assert.equal(changed.candidate.secondaryPBS.password,'');
 for(const backup of [{},{...safe,version:999},{...safe,config:{...safe.config,schemaVersion:999}},{...safe,config:{...safe.config,sources:[{...c.sources[0],path:'/etc'}]}}])assert.throws(()=>previewRestore(backup,c));
});
test('Restore can clear credentials without attaching old secrets to a new PBS, and preserves local auth',()=>{
 const c=config(),state={watchSince:{},jobs:{}};let written;const service=createConfigService({initial:c,state,password:'',isBusy:()=>false,write:value=>written=value,persist(){},onChange(){}});
 const backup=exportConfig(c);backup.config.repository='user@pbs@new:store';backup.config.authEnabled=true;
 const prepared=previewRestore(backup,c);service.apply(prepared.candidate,{replaceSecrets:true});assert.equal(written.password,'');assert.equal(written.authEnabled,false);assert.notEqual(revision(c),revision(written));
});
test('Run comparison uses matching successful runs only, distinguishes unknown upload and avoids zero division',()=>{
 const c=config(),source=c.sources[0],record={path:source.path,repository:c.repository,namespace:'',status:'success'};
 const state={jobs:{},history:{software:[{...record,runId:'2',endedAt:'2026-10-21T01:00:00Z',durationSeconds:180,progress:{processedBytes:200,uploadedBytes:0}},{...record,runId:'1',endedAt:'2026-10-20T01:00:00Z',durationSeconds:120,progress:{processedBytes:100,uploadedBytes:0}},{...record,status:'failed',endedAt:'2026-10-22T01:00:00Z',durationSeconds:1}]}};
 let data=compareRuns(source,c,state);assert.equal(data.changes.durationSeconds.percent,50);assert.equal(data.changes.processedBytes.percent,100);assert.equal(data.changes.uploadedBytes.percent,null);
 state.history.software[0].progress.uploadedBytes=null;assert.equal(compareRuns(source,c,state).changes.uploadedBytes,null);
 c.repository='user@pbs@other:store';assert.equal(compareRuns(source,c,state).latest,null);
});
