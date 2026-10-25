'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWebUpdates}=require('../lib/web-updates'),{performUpdate}=require('../deploy/web-update.cjs');
function fixture(t,options={}){const data=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-web-update-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));const statusFile=path.join(data,'runtime','status.json'),request=path.join(data,'update-request');const manager=createWebUpdates({data,statusFile,updates:{check:async()=>({status:'available'})},isBusy:()=>false,enabled:async()=>true,...options});return {manager,data,statusFile,request};}
test('Web-Update ist ausdrücklich bestätigt, serialisiert und startet nur bei freiem System',async t=>{
 const {manager,request}=fixture(t);await assert.rejects(manager.start({}),/bestätigen/);assert.equal(fs.existsSync(request),false);
 const result=await manager.start({confirm:true,command:'IGNORED'});assert.equal(result.phase,'queued');assert.equal(fs.readFileSync(request,'utf8'),'update\n');assert.equal(manager.pending(),true);await assert.rejects(manager.start({confirm:true}),/bereits/);
});
test('Web-Update verweigert fehlenden Helfer, laufende Aufträge und ungeprüfte oder lokale Stände',async t=>{
 for(const options of [{enabled:async()=>false},{isBusy:()=>true},...['current','modified','diverged','error','unknown'].map(status=>({updates:{check:async()=>({status,message:'Nicht installierbar'})}}))]){const {manager,request}=fixture(t,options);await assert.rejects(manager.start({confirm:true}));assert.equal(fs.existsSync(request),false);assert.equal(manager.pending(),false);}
 let calls=0;const {manager,request}=fixture(t,{isBusy:()=>++calls>1});await assert.rejects(manager.start({confirm:true}));assert.equal(fs.existsSync(request),false);
});
test('Parallele Web-Update-Anforderungen werden vor der asynchronen Prüfung gesperrt',async t=>{
 let release;const {manager}=fixture(t,{enabled:()=>new Promise(resolve=>release=resolve)});const first=manager.start({confirm:true});await assert.rejects(manager.start({confirm:true}),/bereits/);release(true);assert.equal((await first).phase,'queued');
});
test('Fester Root-Helfer ignoriert Anforderungsinhalt und speichert Erfolg oder Fehler für den Neustart',async t=>{
 for(const code of [0,1]){const {manager,request,statusFile}=fixture(t);fs.writeFileSync(request,'untrusted command');let executions=0;const result=await performUpdate({request,directory:path.dirname(statusFile),execute:async()=>{executions++;assert.equal(manager.current().phase,'running');assert.equal(fs.existsSync(request),false);return code;}});assert.equal(result,code);assert.equal(executions,1);assert.equal(manager.current().phase,code===0?'succeeded':'failed');assert.equal(manager.pending(),false);assert.equal(fs.statSync(statusFile).mode&0o777,0o644);}
});
test('Root-Helfer führt ohne reguläre Anforderung nichts aus; Fehler werden erfasst',async t=>{
 const {manager,request,statusFile,data}=fixture(t);let executions=0;const execute=async()=>{executions++;throw Error('simulated failure');};await performUpdate({request,directory:path.dirname(statusFile),execute});assert.equal(executions,0);
 const target=path.join(data,'unchanged');fs.writeFileSync(target,'unchanged');fs.symlinkSync(target,request);await assert.rejects(performUpdate({request,directory:path.dirname(statusFile),execute}),/Ungültig/);assert.equal(fs.readFileSync(target,'utf8'),'unchanged');assert.equal(executions,0);
 fs.writeFileSync(request,'update');await assert.rejects(performUpdate({request,directory:path.dirname(statusFile),execute}),/simulated/);assert.equal(manager.current().phase,'failed');
});
