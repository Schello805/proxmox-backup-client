'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validateDrive, createDrive } = require('../lib/gdrive');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const sources = [{id:'daten',name:'Daten',path:'/mnt/Daten/Daten',expectedSource:'//nas/Daten'}, {id:'musik',name:'Musik',path:'/mnt/Daten/Musik',expectedSource:'//nas/Musik'}];
  const config = {sources, gdrive: validateDrive({remote:'gdrive',folder:'QNAP Backup',sources:['daten','musik'],schedule:''},sources),timezone:'Europe/Berlin',backupPolicy:{rateMiB:2}};
  const state = options.state || {}, calls = [], children = [], notifications = [];
  const spawnProcess = (command,args,opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = signal => { child.signal = signal; if (!options.holdKill) setImmediate(() => child.emit('close', null)); };
    calls.push({command,args,opts});
    if (['copy','sync'].includes(args[0])) children.push(child);
    else setImmediate(() => { if(args[0] === 'about') { if(options.quotaError) { child.emit('close',1); return; } child.stdout.write(JSON.stringify(options.quota || {total:1000,used:200,free:300,other:400,trashed:100})); } if(args[0] === 'listremotes') child.stdout.write(options.remote || 'gdrive: drive\n'); child.emit('close',0); });
    return child;
  };
  let blocked = false;
  const drive = createDrive({getConfig:()=>config,state,persist(){},data:'/tmp/test-drive',inspectPath:async()=> options.badMount ? {ok:false,error:'Falsche Freigabe'} : {ok:true},blocked:()=>blocked,spawnProcess,clock:()=>new Date('2026-10-21T01:00:00Z'),cancelTimeout:10,notify:(...args)=>notifications.push(args)});
  return {drive,config,state,calls,children,notifications,setBlocked(value){blocked=value;}};
}
test('Drive validiert Remote, Zielpfad, Quellen und Monatsplan', () => {
  const {config}=fixture();
  for(const patch of [{remote:':local'},{remote:'-bad'},{folder:'../data'},{folder:'/root'},{folder:'x:y'},{sources:['missing']},{sources:['daten','daten']}]) assert.throws(()=>validateDrive({...config.gdrive,...patch},config.sources));
  assert.equal(validateDrive({...config.gdrive,schedule:{days:[],time:'03:00',monthDay:'last'}},config.sources).schedule.monthDay,'last');
});
test('Drive kopiert Quellen seriell ohne Shell oder Löschbefehl und wertet JSON-Fortschritt aus', async()=>{
  const f=fixture(); f.drive.start(); await tick();await tick();await tick();
  assert.equal(f.children.length,1); assert.equal(f.calls[2].args[0],'copy'); assert.equal(f.calls[2].args[2],'gdrive:QNAP Backup/daten'); assert.ok(f.calls[2].args.includes('--bwlimit'));assert.equal(f.calls[2].opts.shell,undefined);
  f.children[0].stderr.write(JSON.stringify({stats:{bytes:100,totalBytes:200,speed:10,eta:10}})+'\n');assert.equal(f.state.drive.progress.bytes,100);
  f.children[0].emit('close',0);await tick(); assert.equal(f.children.length,2);f.children[1].emit('close',0);await tick();
  assert.equal(f.state.drive.status,'success'); assert.equal(f.state.drive.results.length,2);assert.equal(f.state.drive.history.length,1);assert.equal(f.drive.busy,false);
});
test('Drive wartet auf PBS, blockiert falsche Mounts und lehnt andere Remote-Typen ab',async()=>{
  const waiting=fixture();waiting.setBlocked(true);waiting.drive.start();await tick();assert.equal(waiting.calls.length,0);assert.equal(waiting.state.drive.status,'queued');waiting.drive.cancel();assert.equal(waiting.drive.busy,false);
  for(const options of [{badMount:true},{remote:'gdrive: sftp\n'}]){const f=fixture(options);f.drive.start();await tick();await tick();await tick();assert.equal(f.state.drive.status,'failed');assert.equal(f.children.length,0);}
});
test('Drive-Abbruch bleibt bis Prozessende busy und startet keine weitere Quelle',async()=>{
  const f=fixture({holdKill:true});f.drive.start();await tick();await tick();await tick();f.drive.cancel();assert.equal(f.state.drive.status,'cancelling');assert.equal(f.drive.busy,true);assert.equal(f.children[0].signal,'SIGTERM');
  f.children[0].emit('close',null);await tick();assert.equal(f.state.drive.status,'cancelled');assert.equal(f.children.length,1);assert.equal(f.drive.busy,false);
});
test('Monatsplan löst nur einmal aus, Neustart markiert laufende Kopien unterbrochen',async()=>{
  const f=fixture();f.config.gdrive.schedule={days:[],time:'03:00',monthDay:21};f.setBlocked(true);f.drive.tick();assert.equal(f.state.drive.status,'queued');f.drive.cancel();f.drive.tick();assert.equal(f.state.drive.status,'cancelled');assert.equal(f.state.drive.triggered,'2026-10-21');
  const restarted=fixture({state:{drive:{status:'running'}}});assert.equal(restarted.state.drive.status,'interrupted');assert.equal(restarted.drive.busy,false);
});

test('Drive-Übersicht liefert gespeicherte Quellen und nächsten Monatstermin in der App-Zeitzone',()=>{
  const f=fixture();f.config.gdrive.schedule={days:[],time:'04:15',monthDay:'last'};
  const snapshot=f.drive.snapshot();assert.deepEqual(snapshot.sources,[{id:'daten',name:'Daten'},{id:'musik',name:'Musik'}]);assert.equal(snapshot.nextAt,'2026-10-31T03:15:00.000Z');assert.equal(snapshot.timezone,'Europe/Berlin');assert.equal(snapshot.settings.remote,'gdrive');assert.equal(f.calls.length,0);
});

test('Google-Quote berücksichtigt andere Dienste, behält bei Fehlern den letzten Stand und trennt Remotes',async()=>{
  const f=fixture();const first=await f.drive.refreshCapacity();assert.equal(first.usedPercent,70);assert.equal(first.used,200);assert.equal(first.other,400);assert.equal(first.available,300);
  const broken=fixture({state:{drive:{status:'idle',capacity:first}},quotaError:true});const failed=await broken.drive.refreshCapacity();assert.equal(failed.usedPercent,70);assert.equal(failed.available,300);assert.ok(failed.error);assert.match(broken.notifications[0][0],/gdrive\/capacity/);
  broken.config.gdrive.remote='other';assert.equal(broken.drive.capacity().available,undefined);
  const {parseDriveCapacity}=require('../lib/drive-capacity');assert.equal(parseDriveCapacity({used:123}).total,null);assert.equal(parseDriveCapacity({used:123}).usedPercent,null);assert.equal(parseDriveCapacity({}).unsupported,true);for(const invalid of [{free:-1},{total:'100'},[]])assert.throws(()=>parseDriveCapacity(invalid));
});
test('Google Drive nutzt eigenes Upload-Limit und meldet Fehler, aber keine Abbrüche',async()=>{
  const f=fixture();f.config.backupPolicy.driveRateMiB=7;f.drive.start();await tick();await tick();await tick();const args=f.calls.find(call=>call.args[0]==='copy').args;assert.equal(args[args.indexOf('--bwlimit')+1],'7M');f.children[0].emit('close',1);await tick();assert.equal(f.notifications.length,1);assert.match(f.notifications[0][0],/^gdrive\/run\//);assert.ok(!f.notifications[0][1].includes('/mnt/'));
  const cancelled=fixture();cancelled.drive.start();await tick();await tick();await tick();cancelled.drive.cancel();await tick();assert.equal(cancelled.notifications.length,0);
  const unlimited=fixture();unlimited.config.backupPolicy.driveRateMiB=0;unlimited.drive.start();await tick();await tick();await tick();assert.ok(!unlimited.calls.find(call=>call.args[0]==='copy').args.includes('--bwlimit'));unlimited.drive.cancel();await tick();
});
test('Google-Quote läuft nicht parallel zur Kopie; Aufträge warten auf eine laufende Prüfung',async()=>{
  const f=fixture();const checking=f.drive.check();f.drive.start();assert.equal(f.state.drive.status,'queued');assert.equal(f.children.length,0);f.drive.cancel();assert.equal(f.state.drive.status,'cancelled');await checking;f.drive.tick();assert.equal(f.children.length,0);f.drive.start();await tick();await tick();await tick();assert.equal(f.children.length,1);assert.equal((await f.drive.refreshCapacity()).deferred,true);f.drive.cancel();await tick();
});

test('Synchronisierung benötigt ausdrückliche Löschbestätigung und verwendet nur den Quell-Unterordner',async()=>{
 const f=fixture();assert.equal(f.config.gdrive.mode,'copy');assert.throws(()=>validateDrive({...f.config.gdrive,mode:'sync'},f.config.sources),/bestätigen/);assert.throws(()=>validateDrive({...f.config.gdrive,mode:'bisync'},f.config.sources),/Modus/);
 f.config.gdrive=validateDrive({...f.config.gdrive,mode:'sync',syncConfirmed:true},f.config.sources);f.drive.start();await tick();await tick();await tick();
 const args=f.calls.find(call=>call.args[0]==='sync').args;assert.equal(args[1],'/mnt/Daten/Daten');assert.equal(args[2],'gdrive:QNAP Backup/daten');assert.ok(args.includes('--delete-after'));assert.ok(!args.includes('--ignore-errors'));assert.equal(f.state.drive.mode,'sync');
 f.children[0].emit('close',0);await tick();f.children[1].emit('close',0);await tick();assert.equal(f.state.drive.status,'success');assert.equal(f.state.drive.history[0].mode,'sync');assert.match(f.state.drive.message,/synchronisiert/);
});
test('Synchronisierung verweigert unbestätigte oder falsche SMB-Quellen',async()=>{
 for(const badMount of [false,true]){const f=fixture({badMount});f.config.gdrive=validateDrive({...f.config.gdrive,mode:'sync',syncConfirmed:true},f.config.sources);if(!badMount)f.config.sources[0].expectedSource='';f.drive.start();await tick();await tick();await tick();assert.equal(f.state.drive.status,'failed');assert.equal(f.calls.some(call=>call.args[0]==='sync'),false);}
});
