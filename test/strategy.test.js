'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,empty,validateMapping,revision,strategyView}=require('../lib/strategy');
const {validateConfig}=require('../lib/validation');
const fixture=require('./strategy-fixture.cjs');
const config=()=>validateConfig({repository:'backup@pbs@pbs:store',password:'secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false},{password:''});
test('Planner-Import übernimmt nur erlaubte Metadaten und reaktiviert keine gelöschten Pläne',()=>{
 const input=fixture();input.password='secret';Object.assign(input.data.plans[0],{retention_value:30,retention_unit:'days',owner:'Test',immutable:1});input.data.plans[0].command='rm -rf /';
 const result=normalize(input);assert.equal(result.document.data.plans.length,2);assert.match(result.warnings.join(),/inaktive/);assert.equal(result.document.data.plans[0].retention_value,30);assert.equal(result.document.data.plans[0].immutable,1);assert.ok(!JSON.stringify(result.document).includes('secret'));assert.ok(!JSON.stringify(result.document).includes('rm -rf'));
 assert.deepEqual(input.data.plans[0].command,'rm -rf /');assert.notEqual(revision(result.document),revision(empty()));
});
test('Import verweigert defekte Referenzen, Zyklen, widersprüchliche Datenbestände und Zeitpläne',()=>{
 for(const mutate of [d=>d.format=2,d=>d.data.sources[0].location_id='missing',d=>d.data.locations[0].parent_id='room',d=>d.data.datasets[0].id='__proto__',d=>d.data.plans[0].target_id='missing',d=>d.data.plans[0].dataset_ids=[],d=>d.data.plans[0].start_time='25:00',d=>d.data.datasets.push({...d.data.datasets[0]})]){
  const input=fixture();mutate(input);assert.throws(()=>normalize(input));
 }
});
test('Zuordnungen sind explizit und referenzieren nur vorhandene App-Quellen und Ziele',()=>{
 const doc=normalize(fixture()).document,cfg=config();
 assert.deepEqual(validateMapping({datasets:{docs:'software'},targets:{pbs:'primary'}},doc,cfg),{datasets:{docs:'software'},targets:{pbs:'primary'}});
 assert.throws(()=>validateMapping({datasets:{docs:'missing'},targets:{}},doc,cfg));assert.throws(()=>validateMapping({datasets:{},targets:{pbs:'extra8'}},doc,cfg));
 const state={jobs:{},history:{}};doc.mapping={datasets:{},targets:{}};
 let view=strategyView(doc,cfg,state,{},new Date('2026-10-24T10:00:00Z'));
 assert.equal(view.external[0].bindings.length,0);assert.equal(view.external[0].status,'unverified');
 doc.mapping={datasets:{docs:'software'},targets:{pbs:'primary'}};
 state.jobs.software={status:'success',lastSuccess:'2026-10-23T10:00:00Z'};
 view=strategyView(doc,cfg,state,{},new Date('2026-10-24T10:00:00Z'));
 assert.deepEqual(view.external[0].bindings,['pbs:software']);assert.equal(view.external[0].lastSuccess,null);assert.equal(view.external[0].status,'unverified');
 assert.equal(view.days.find(day=>day.day==='2026-10-25').end-view.days.find(day=>day.day==='2026-10-25').start,25*3600000);
 assert.ok(view.events.some(event=>event.jobId==='external:daily'));
});
test('Gemeinsamer Kalender trennt gemessene App-Dauer von externer Planung und unterstützt Monat/Zeitraum',()=>{
 const doc=normalize(fixture()).document,cfg=config();doc.mapping={datasets:{},targets:{}};
 cfg.schedules.software={days:[1,2,3,4,5,6,7],time:'00:30'};
 const state={jobs:{},history:{software:[{status:'success',path:cfg.sources[0].path,repository:cfg.repository,namespace:'',startedAt:'2026-10-23T10:00:00Z',endedAt:'2026-10-23T12:00:00Z',durationSeconds:7200}]}};
 let view=strategyView(doc,cfg,state,{},new Date('2026-10-24T10:00:00Z'),'2026-11-01');
 assert.equal(view.days[0].day,'2026-11-01');assert.equal(view.jobs[0].durationKind,'measured');assert.equal(view.jobs[0].seconds,7200);assert.equal(view.external[0].durationKind,'planned');
 assert.throws(()=>strategyView(doc,cfg,state,{},new Date(),'2026-02-31'));
 const monthly=fixture();Object.assign(monthly.data.plans[0],{schedule_type:'monthly',day_of_month:'last'});assert.equal(normalize(monthly).document.data.plans[0].day_of_month,'last');
});
