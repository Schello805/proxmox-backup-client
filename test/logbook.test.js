'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLogbook}=require('../lib/logbook');
test('Zentrales Protokoll liest nur indizierte Läufe, auch abgemeldete Quellen, und blendet Zugangsdaten aus',()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'logbook-')),runId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 try{
 fs.mkdirSync(path.join(data,'history','removed'),{recursive:true});fs.writeFileSync(path.join(data,'history','removed',runId+'.log'),'x'.repeat(300000)+' secret token');
 const book=createLogbook({data,getConfig:()=>({sources:[],password:'secret',notifications:{token:'token'}}),state:{jobs:{},history:{removed:[{runId,status:'success',repository:'backup@pbs@server:store'}]},drive:{status:'failed',message:'secret',results:[],history:[]}}});
 const entries=book.list();assert.equal(entries.length,2);assert.equal(entries.find(entry=>entry.kind==='PBS').sourceName,'removed');assert.ok(!JSON.stringify(entries).includes('secret'));assert.throws(()=>book.read('../../etc/passwd'),/nicht vorhanden/);
 const text=book.read('pbs:removed:'+runId);assert.ok(!text.includes('secret'));assert.ok(!text.includes('token'));assert.ok(text.endsWith('[ausgeblendet] [ausgeblendet]'));assert.ok(text.length<270000);
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});
