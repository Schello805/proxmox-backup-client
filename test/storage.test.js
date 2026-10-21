'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, loadState, acquireLock } = require('../lib/storage');
const defaults = path.join(__dirname,'..','config.example.json');
test('Migration sichert Original, erhält Zugang und Wochenplan und läuft nur einmal', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-migration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'config.json'), raw=JSON.stringify({repository:'backup@pbs@pbs:store',password:'dummy-secret',fingerprint:'',namespace:'',schedules:{software:'03:15'},authEnabled:false});fs.writeFileSync(file,raw);
 const preview=loadConfig(file,defaults,'',{readOnly:true});assert.equal(preview.schemaVersion,5);assert.equal(fs.readFileSync(file,'utf8'),raw);assert.equal(fs.readdirSync(dir).length,1);
 const migrated=loadConfig(file,defaults,'');assert.equal(migrated.password,'dummy-secret');assert.deepEqual(migrated.schedules.software.days,[1,2,3,4,5,6,7]);assert.equal(migrated.sources.length,6);
 const backup=fs.readdirSync(dir).find(name=>name.includes('.pre-v5-'));assert.ok(backup);assert.equal(fs.readFileSync(path.join(dir,backup),'utf8'),raw);
 loadConfig(file,defaults,'');assert.equal(fs.readdirSync(dir).length,2);
});
test('Kaputte und zukünftige Konfigurationen bleiben unverändert',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-bad-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');
 for(const text of ['{broken',JSON.stringify({schemaVersion:999})]){fs.writeFileSync(file,text);assert.throws(()=>loadConfig(file,defaults,''));assert.equal(fs.readFileSync(file,'utf8'),text);}
 fs.writeFileSync(file,'[]');assert.throws(()=>loadState(file),/JSON-Objekt/);
});

test('Zweite Instanz wird vor Status- und Konfigurationsänderungen abgehalten',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const release=acquireLock(dir);assert.throws(()=>acquireLock(dir),/App-Instanz/);release();const again=acquireLock(dir);again();assert.equal(fs.readdirSync(dir).length,0);
});
