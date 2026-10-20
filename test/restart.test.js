'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
test('Neustart archiviert unterbrochene Läufe einmalig und erhält Beobachtungsbeginn', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'qnap-restart-'));
  const configFile=path.join(tmp,'config.json'), stateFile=path.join(tmp,'state.json');
  fs.writeFileSync(configFile,JSON.stringify({repository:'',password:'',fingerprint:'',namespace:'',schedules:{software:'02:30'}}));
  fs.writeFileSync(stateFile,JSON.stringify({jobs:{software:{status:'running',startedAt:'2026-10-19T00:00:00Z'}},triggered:{},watchSince:{software:'2026-10-18T00:00:00Z'}}));
  fs.writeFileSync(path.join(tmp,'software.log'),'Unterbrochenes Testprotokoll');
  let child;
  t.after(async()=>{ if(child && child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');} fs.rmSync(tmp,{recursive:true,force:true}); });
  async function start() {
    child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,APP_PASSWORD:'123456',HOST:'127.0.0.1',PORT:'0',CONFIG_FILE:configFile,DATA_DIR:tmp},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Serverstart überschritten')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server beendet: ${code}`));});});
  }
  await start();
  let state=JSON.parse(fs.readFileSync(stateFile));
  assert.equal(state.jobs.software.status,'interrupted'); assert.equal(state.history.software.length,1); assert.equal(state.watchSince.software,'2026-10-18T00:00:00Z');
  const id=state.history.software[0].runId; assert.match(fs.readFileSync(path.join(tmp,'history','software',id+'.log'),'utf8'),/Testprotokoll/);
  child.kill('SIGTERM');await once(child,'exit'); await start();
  state=JSON.parse(fs.readFileSync(stateFile)); assert.equal(state.history.software.length,1); assert.equal(state.history.software[0].runId,id);
});
