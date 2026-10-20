'use strict';
const { test }=require('node:test');const assert=require('node:assert/strict');
test('Probleme nennen falsche SMB-Zuordnungen und führen zur Quelle statt zur unbemerkten Bestätigung',async()=>{
 const {sourceProblem}=await import('../public/js/problems.js');const folder={name:'Daten',ok:false,expectedSource:'//nas/Daten',mount:{source:'//nas/Software',type:'cifs'}};const issue=sourceProblem(folder);
 assert.equal(issue.message,'Daten zeigt auf „Software“ statt „Daten“.');assert.equal(issue.action,'Zuordnung prüfen');assert.equal(issue.view,'source');
 assert.match(sourceProblem({...folder,expectedSource:'//old/Software'}).message,/\/\/nas\/Software/);
});
test('Problemaktionen unterscheiden fehlenden Mount, PBS-Zugang, Laufabbruch und Überfälligkeit',async()=>{
 const {sourceProblem}=await import('../public/js/problems.js');const folder={name:'Daten',ok:true,targetRepository:'backup@pbs@pbs:store',job:{status:'idle'}};
 assert.equal(sourceProblem({...folder,ok:false}).action,'Mount prüfen');assert.equal(sourceProblem({...folder,ok:false,expectedSource:'//nas/Daten',mount:{source:'/dev/sda1',type:'ext4'}}).action,'Mount prüfen');assert.equal(sourceProblem({...folder,targetRepository:''}).view,'targets');
 assert.equal(sourceProblem(folder,{}, {},{hasPassword:true},{ok:false}).action,'Backup-Ziel prüfen');assert.equal(sourceProblem(folder,{status:'failed'}).view,'log');
 assert.equal(sourceProblem(folder,{status:'interrupted'}).view,'backup');assert.equal(sourceProblem(folder,{}, {missed:true}).action,'Jetzt sichern');assert.equal(sourceProblem(folder),null);
});
