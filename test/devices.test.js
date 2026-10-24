'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,validateMapping,strategyView}=require('../lib/strategy');const {validateConfig}=require('../lib/validation');const fixture=require('./strategy-fixture.cjs');
const config=()=>validateConfig({repository:'root@pam@pbs:pbs2',password:'secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false},{password:''});
test('Geräte können Daten und Speicherziele zugleich bereitstellen, ohne Mounts oder Aufträge zu ändern',()=>{
 const input=fixture();input.data.sources.push({id:'pbs-device',name:'PBS',device_type:'server'});input.data.targets[0].device_id='pbs-device';const doc=normalize(input).document,cfg=config(),before=JSON.stringify(cfg);
 doc.mapping=validateMapping({datasets:{docs:'software'},targets:{pbs:'primary'},devices:{software:'nas',musik:'nas'},targetDevices:{primary:'pbs-device'}},doc,cfg);
 const view=strategyView(doc,cfg,{jobs:{},history:{}},{},new Date('2026-10-24T10:00:00Z'));
 assert.equal(view.catalogSources.find(row=>row.appSourceId==='software').device,'Test-NAS');assert.equal(view.catalogSources.find(row=>row.appSourceId==='musik').device,'Test-NAS');assert.equal(view.catalogTargets.find(row=>row.appTargetId==='primary').device,'PBS');assert.equal(view.catalogTargets.find(row=>row.appTargetId==='primary').name,'pbs2');assert.equal(JSON.stringify(cfg),before);
});
test('Geräte werden nicht aus gleichlautenden Namen oder ursprünglichen Datenbeständen geraten',()=>{
 const doc=normalize(fixture()).document,cfg=config();doc.mapping={datasets:{docs:'software'},targets:{pbs:'primary'}};
 const view=strategyView(doc,cfg,{jobs:{},history:{}},{});assert.equal(view.catalogSources.find(row=>row.appSourceId==='software').deviceId,null);assert.equal(view.catalogTargets.find(row=>row.appTargetId==='primary').deviceId,null);
});
test('Ungültige Geräteverweise und das Entfernen verwendeter Geräte werden abgewiesen',()=>{
 const input=fixture();input.data.targets[0].device_id='missing';assert.throws(()=>normalize(input),/Gerät/);
 const doc=normalize(fixture()).document,cfg=config();assert.throws(()=>validateMapping({datasets:{},targets:{},devices:{software:'missing'}},doc,cfg),/Gerät/);
 assert.throws(()=>validateMapping({datasets:{},targets:{},targetDevices:{primary:'missing'}},doc,cfg),/Gerät/);
});
test('Gerätezuordnungen bleiben beim nativen Export-/Importformat erhalten',()=>{
 const cfg=config(),doc=normalize(fixture()).document;doc.mapping=validateMapping({datasets:{},targets:{},devices:{software:'nas'},targetDevices:{primary:'nas'}},doc,cfg);
 const exported=JSON.parse(JSON.stringify(doc)),restored=normalize(exported).document;restored.mapping=validateMapping(exported.mapping,restored,cfg);assert.deepEqual(restored.mapping,doc.mapping);
});
test('Ein ausdrücklich zugeordnetes Gerät beschreibt die tatsächliche Kopie, nicht automatisch den ursprünglichen Datenursprung',()=>{
 const input=fixture();input.data.sources.push({id:'qnap4',name:'QNAP4bay',device_type:'nas'});const doc=normalize(input).document,cfg=config();doc.mapping={datasets:{docs:'software'},targets:{pbs:'primary'},devices:{software:'qnap4'}};doc.data.plans[0].implementation='app';
 const view=strategyView(doc,cfg,{jobs:{},history:{}},{}),job=view.jobs.find(job=>job.sourceId==='software');assert.equal(job.sourceDeviceId,'qnap4');assert.ok(job.resources.includes('device:qnap4'));assert.ok(!job.resources.includes('device:nas'));
});
