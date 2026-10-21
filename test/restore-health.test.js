'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pbsContentLink,restoreInfo}=require('../lib/restore');
const {validateConfig}=require('../lib/validation');
test('PBS links select datastore content without credentials and reject unsafe hosts',()=>{
 assert.equal(pbsContentLink('backup@pbs!token@192.168.1.7:pbs1').url,'https://192.168.1.7:8007/#DataStore-pbs1:content');
 assert.equal(pbsContentLink('backup@pbs@pbs.example:8443:store-2').url,'https://pbs.example:8443/#DataStore-store-2:content');
 assert.equal(pbsContentLink('backup@pbs@pbs.example:443:pbs1').url,'https://pbs.example/#DataStore-pbs1:content');
 assert.equal(pbsContentLink('backup@pbs@[::1]:pbs1').url,'https://[::1]:8007/#DataStore-pbs1:content');
 for(const repository of ['', 'user@pbs@server/path:store','user@pbs@server?x:store','user@pbs@server:store#bad','user@pbs@server:999999:store','user@pbs@server:0:store'])assert.equal(pbsContentLink(repository),null,repository);
});
test('Restore metadata follows source target and namespace, isolates host group and never includes passwords',()=>{
 const config=validateConfig({repository:'backup@pbs@one.local:store',password:'primary-secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false,secondaryDatastore:'archive',secondaryPBS:{server:'two.local',authId:'other@pbs',password:'secondary-secret',fingerprint:'',namespace:'nas/data'}},{password:''});
 const source={...config.sources[0],target:'secondary'},cache={checkedAt:'2026-10-21T10:00:00Z',error:'',snapshots:[{group:'host/software',time:'2026-10-21T09:00:00.000Z',files:['qnap-software.pxar.didx']},{group:'ct/software',time:'2026-10-21T08:00:00.000Z',files:['root.pxar.didx']},{group:'host/filme',time:'2026-10-21T08:00:00.000Z',files:[]},{group:'host/software',time:'2026-10-20T09:00:00.000Z',files:['legacy.pxar.didx']}]};
 const info=restoreInfo(source,config,cache);assert.equal(info.url,'https://two.local:8007/#DataStore-archive:content');assert.equal(info.namespace,'nas/data');assert.equal(info.snapshots.length,2);assert.equal(info.snapshots[0].snapshot,'host/software/2026-10-21T09:00:00Z');assert.equal(info.snapshots[0].archivePresent,true);assert.equal(info.snapshots[1].archivePresent,false);assert.ok(!JSON.stringify(info).includes('secret'));
 assert.deepEqual(restoreInfo(source,config,{error:'Abruf fehlgeschlagen'}).snapshots,[]);
});
test('Health never reports unknown or stale checks as current success; latest PBS evidence wins',async()=>{
 const {sourceHealth,latestConnection}=await import('../public/js/problems.js');
 const now=Date.parse('2026-10-21T10:00:00Z'),folder={name:'Daten',ok:true,expectedSource:'//nas/Daten',targetRepository:'backup@pbs@pbs:store',mount:{source:'//nas/Daten',type:'cifs'}},job={status:'success',lastSuccess:'2026-10-20T10:00:00Z'},target={hasPassword:true};
 assert.equal(sourceHealth(folder,{}, {},target,undefined,{},now).label,'Noch keine Sicherung');
 assert.equal(sourceHealth(folder,job,{},target,undefined,{},now).label,'PBS erneut prüfen');
 const old={ok:false,checkedAt:'2026-10-21T09:00:00Z'},fresh={checkedAt:'2026-10-21T09:59:00Z'};
 assert.equal(sourceHealth(folder,job,{},target,old,fresh,now).label,'Alles aktuell');assert.equal(sourceHealth(folder,job,{},target,old,fresh,now).view,'restore');
 const failure={ok:false,checkedAt:'2026-10-21T10:00:00Z'};assert.equal(sourceHealth(folder,job,{},target,failure,fresh,now).label,'PBS-Zugang gestört');
 assert.equal(latestConnection(job,{ok:true,checkedAt:'2026-10-21T09:58:00Z'},{error:'Nicht abrufbar',attemptedAt:'2026-10-21T09:59:00Z'}).ok,false);
 assert.equal(sourceHealth({...folder,checking:true,checkedAt:null},job,{},target,undefined,fresh,now).label,'Wird geprüft');
});
test('Health distinguishes SMB mismatch, missing target, failed, overdue, busy and cancelled runs',async()=>{
 const {sourceHealth}=await import('../public/js/problems.js');const folder={name:'Daten',ok:true,expectedSource:'//nas/Daten',targetRepository:'u@pbs@pbs:store',mount:{source:'//nas/Daten',type:'cifs'}};
 assert.equal(sourceHealth({...folder,ok:false,mount:{source:'//nas/Software',type:'cifs'}}).label,'SMB-Zuordnung falsch');
 assert.equal(sourceHealth({...folder,ok:false,mount:{source:'/dev/sda1',type:'ext4'}}).label,'SMB nicht verfügbar');
 assert.equal(sourceHealth({...folder,targetRepository:''}).label,'PBS einrichten');
 assert.equal(sourceHealth(folder,{status:'failed'}).view,'log');assert.equal(sourceHealth(folder,{status:'interrupted'}).view,'backup');
 assert.equal(sourceHealth(folder,{status:'success'},{missed:true}).label,'Sicherung überfällig');assert.equal(sourceHealth(folder,{status:'running'}).label,'Backup läuft');assert.equal(sourceHealth(folder,{status:'cancelled'}).label,'Abgebrochen');
 assert.equal(sourceHealth({...folder,expectedSource:''}).label,'SMB bestätigen');
});

test('Changed PBS credentials invalidate older success evidence; live client upload is fresh evidence',async()=>{
 const {sourceHealth,latestConnection}=await import('../public/js/problems.js');
 const job={status:'success',lastSuccess:'2026-10-21T09:59:00Z'},folder={name:'Daten',ok:true,expectedSource:'//nas/Daten',targetRepository:'u@pbs@pbs:store',pbsCheckAfter:'2026-10-21T10:00:00Z'},now=Date.parse('2026-10-21T10:00:01Z');
 assert.equal(sourceHealth(folder,job,{}, {hasPassword:true},{ok:true,checkedAt:job.lastSuccess},{checkedAt:job.lastSuccess},now).label,'PBS erneut prüfen');
 assert.equal(latestConnection({status:'running',progress:{uploadedBytes:100,updatedAt:'2026-10-21T10:00:02Z'}},{ok:false,checkedAt:'2026-10-21T10:00:01Z'},{}).ok,true);
});
