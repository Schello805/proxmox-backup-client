'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('Update-Vorprüfung verändert weder Daten noch Konfiguration und verweigert laufende Backups',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qnap-preflight-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(__dirname,'..'),file=path.join(dir,'config.json'),stateFile=path.join(dir,'state.json'),envFile=path.join(dir,'app.env'),bin=path.join(dir,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'proxmox-backup-client'),'#!/bin/sh\nprintf "test-client\\n"\n',{mode:0o700});
 const raw=JSON.stringify({repository:'',password:'',fingerprint:'',namespace:'',schedules:{},authEnabled:false});fs.writeFileSync(file,raw);fs.writeFileSync(stateFile,JSON.stringify({jobs:{}}));fs.writeFileSync(envFile,'APP_PASSWORD=\nPORT=3000\n');
 const env={...process.env,APP_DIR:root,DATA_DIR:dir,CONFIG_FILE:file,ENV_FILE:envFile,PATH:bin+path.delimiter+process.env.PATH};
 const result=spawnSync('sh',[path.join(root,'deploy','update.sh'),'--check'],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(file,'utf8'),raw);assert.equal(fs.existsSync(path.join(dir,'maintenance')),false);assert.equal(fs.readdirSync(dir).some(name=>name.includes('.pre-v2-')),false);
 fs.writeFileSync(stateFile,JSON.stringify({jobs:{software:{status:'running'}}}));const busy=spawnSync('sh',[path.join(root,'deploy','update.sh'),'--check'],{env,encoding:'utf8'});assert.equal(busy.status,2);assert.match(busy.stderr,/Backup läuft/);assert.equal(fs.existsSync(path.join(dir,'maintenance')),false);
});
