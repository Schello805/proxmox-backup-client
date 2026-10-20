'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
test('Ohne APP_PASSWORD startet die App offen; die Auswahl bleibt beim Neustart erhalten',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-auth-')), configFile=path.join(tmp,'config.json');
 fs.writeFileSync(configFile,JSON.stringify({repository:'',password:'',fingerprint:'',namespace:'',schedules:{}}));
 let child;
 t.after(async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}fs.rmSync(tmp,{recursive:true,force:true});});
 async function start(password){
  child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,APP_PASSWORD:password,HOST:'127.0.0.1',PORT:'0',CONFIG_FILE:configFile,DATA_DIR:tmp},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Start überschritten')),5000);child.stdout.on('data',data=>{const match=data.toString().match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server beendet: ${code}`));});});
 }
 let url=await start('');
 assert.deepEqual(await(await fetch(url+'/api/session')).json(),{authenticated:true,authEnabled:false});
 const headers={'Content-Type':'application/json','X-Requested-With':'qnap-dashboard'};
 const rejected=await fetch(url+'/api/auth',{method:'POST',headers,body:JSON.stringify({enabled:true})});
 assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/APP_PASSWORD/);
 assert.equal((await fetch(url+'/api/auth',{method:'POST',headers,body:JSON.stringify({enabled:false})})).status,200);
 child.kill('SIGTERM');await once(child,'exit');url=await start('123456');
 assert.deepEqual(await(await fetch(url+'/api/session')).json(),{authenticated:true,authEnabled:false});
 assert.equal((await fetch(url+'/api/status')).status,200);
});
