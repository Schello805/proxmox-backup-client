'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,strategyView,validateImplementation}=require('../lib/strategy');
const {analyze}=require('../lib/network-planning');
const {validateConfig}=require('../lib/validation');
const fixture=require('./strategy-fixture.cjs');
const config=()=>validateConfig({repository:'backup@pbs@pbs:store',password:'secret',fingerprint:'',namespace:'',schedules:{},authEnabled:false},{password:''});
test('Ältere Pläne bleiben geplant; externe Umsetzung benötigt ein ausführendes System',()=>{
 let doc=normalize(fixture()).document;assert.equal(doc.data.plans[0].implementation,'planned');
 const input=fixture();input.data.plans[0].implementation='external';assert.throws(()=>normalize(input),/ausführende System/);
 input.data.plans[0].executor='Proxmox pve';doc=normalize(input).document;
 const view=strategyView(doc,config(),{jobs:{},history:{}},{},new Date('2026-10-24T10:00:00Z'));
 assert.equal(view.external[0].executionReady,true);assert.equal(view.external[0].lastSuccess,null);assert.equal(view.external[0].status,'unverified');assert.equal(view.catalogSources.filter(source=>source.datasetId==='docs').length,1);
 for(const modify of [d=>d.data.plans[0].implementation='magic',d=>d.data.plans[0].bandwidth_mib=-1,d=>d.data.plans[0].network_id='missing',d=>d.data.networks=[{id:'lan',name:'LAN',capacity_mib:0}]]){const bad=fixture();modify(bad);assert.throws(()=>normalize(bad));}
});
test('App-Umsetzung verlangt passende vollständige Zuordnung und übernimmt den echten App-Zeitplan',()=>{
 const cfg=config(),doc=normalize(fixture()).document,state={jobs:{},history:{}};doc.data.plans[0].implementation='app';
 assert.throws(()=>validateImplementation(doc,cfg,state,{}),/eingebundenen Ordner auswählen/);
 doc.mapping={datasets:{docs:'software'},targets:{pbs:'primary'}};validateImplementation(doc,cfg,state,{});
 cfg.schedules.software={days:[1],time:'06:00'};
 const view=strategyView(doc,cfg,state,{},new Date('2026-10-24T10:00:00Z'));
 assert.equal(view.external[0].appSchedules[0].schedule.time,'06:00');assert.equal(view.catalogSources.filter(source=>source.datasetId==='docs').length,0);assert.ok(view.catalogSources.find(source=>source.appSourceId==='software').datasetIds.includes('docs'));
 doc.data.plans[0].protection_type='synchronization';assert.throws(()=>validateImplementation(doc,cfg,state,{}));
});
test('Fehlende App-Verknüpfung nach Konfigurationsänderung erzeugt keinen erfundenen Laufnachweis',()=>{
 const cfg=config(),doc=normalize(fixture()).document;doc.data.plans[0].implementation='app';doc.mapping={datasets:{docs:'software'},targets:{pbs:'primary'}};cfg.password='';
 const view=strategyView(doc,cfg,{jobs:{},history:{}},{},new Date('2026-10-24T10:00:00Z'));
 assert.equal(view.external[0].executionReady,false);assert.equal(view.external[0].lastSuccess,null);
});
const job=(id,rate,engine='external')=>({id,name:id,engine,schedule:{time:'02:00'},seconds:100,resources:['device:nas'],networks:[{id:'lan',rate}]});
const event=id=>({jobId:id,start:1000,end:100000});
const review=jobs=>analyze({jobs,events:jobs.map(item=>event(item.id)),networks:[{id:'lan',name:'LAN',capacity_mib:100}],resources:{sources:[{id:'nas',name:'NAS'}]},start:0,end:200000});
test('Netzlast summiert externe Sicherungen, berücksichtigt die App-Warteschlange und trennt Schätzung von Messung',()=>{
 let result=review([job('a',70),job('b',50)]);assert.equal(result.networks[0].peakMiB,120);assert.equal(result.warnings[0].kind,'capacity');assert.ok(result.warnings.some(warning=>warning.kind==='shared'));
 result=review([job('a',70,'pbs'),job('b',80,'gdrive')]);assert.equal(result.networks[0].peakMiB,80);assert.equal(result.networks[0].overload,null);assert.ok(result.warnings.some(warning=>warning.kind==='queue'));
 result=review([job('a',70,'pbs'),job('b',80,'gdrive'),job('c',50)]);assert.equal(result.networks[0].peakMiB,130);
 result=review([job('a',null),job('b',20)]);assert.equal(result.networks[0].incomplete,true);assert.equal(result.networks[0].overload,null);
});
test('Unbekannte Dauer wird nicht als fünfminütige Sicherung erfunden; noch geplante Wege sind nur Simulation',()=>{
 const unknown={...job('unknown',30),seconds:null};let result=analyze({jobs:[unknown],events:[{jobId:'unknown',start:1000,end:null}],networks:[{id:'lan',name:'LAN',capacity_mib:100}],start:0,end:200000});assert.deepEqual(result.unknownDuration,['unknown']);assert.equal(result.networks[0].incomplete,true);assert.equal(result.networks[0].overload,null);
 const input=fixture();input.data.networks=[{id:'lan',name:'LAN',capacity_mib:50}];Object.assign(input.data.plans[0],{network_id:'lan',bandwidth_mib:90});const doc=normalize(input).document,view=strategyView(doc,config(),{jobs:{},history:{}},{},new Date('2026-10-24T10:00:00Z'));
 assert.equal(view.analysis.warnings.filter(warning=>warning.kind==='capacity').length,0);assert.ok(view.planningAnalysis.warnings.some(warning=>warning.kind==='capacity'));
});

test('App-Verknüpfungsfehler nennen die tatsächlich fehlende oder widersprüchliche Einstellung',()=>{
 const cfg=config(),doc=normalize(fixture()).document,state={jobs:{},history:{}};const plan=doc.data.plans[0];plan.implementation='app';doc.mapping={datasets:{docs:'software'},targets:{}};
 assert.throws(()=>validateImplementation(doc,cfg,state,{}),/App-Ziel auswählen/);
 doc.mapping.targets.pbs='primary';plan.protection_type='synchronization';
 assert.throws(()=>validateImplementation(doc,cfg,state,{}),/verwendet „Sicherung mit Versionen“.*„Synchronisierung“.*Schutzart im Plan anpassen/);
 plan.protection_type='backup';cfg.password='';assert.throws(()=>validateImplementation(doc,cfg,state,{}),/vollständigen Zielzugang/);
 cfg.password='secret';doc.mapping.datasets.docs='serien';cfg.sources.find(item=>item.id==='serien').target='secondary';assert.throws(()=>validateImplementation(doc,cfg,state,{}),/Kein App-Auftrag.*Serien/);
});

test('Freie Plan-, Daten- und Zielnamen ändern keine explizite ID-Zuordnung',()=>{
 const cfg=config(),doc=normalize(fixture()).document,state={jobs:{},history:{}};doc.data.plans=[doc.data.plans[0]];doc.data.plans[0].implementation='app';doc.data.plans[0].name='Familienarchiv ohne Quellnamen';doc.data.datasets[0].name='Familiendaten';doc.data.targets[0].name='Freies Sicherungsziel';cfg.sources.find(source=>source.id==='software').name='Daten auf dem NAS';doc.mapping={datasets:{docs:'software'},targets:{pbs:'primary'}};
 validateImplementation(doc,cfg,state,{});let view=strategyView(doc,cfg,state,{});assert.deepEqual(view.external[0].bindings,['pbs:software']);
 doc.data.plans[0].name='Anderer beliebiger Name';doc.data.datasets[0].name='Noch ein anderer Name';validateImplementation(doc,cfg,state,{});view=strategyView(doc,cfg,state,{});assert.deepEqual(view.external[0].bindings,['pbs:software']);
});
test('Ein aufgeteiltes Datenverzeichnis lässt sich je Ziel unabhängig verknüpfen',()=>{
 const cfg=config(),doc=normalize(fixture()).document;cfg.secondaryDatastore='pbs2';cfg.additionalDatastores=[{id:'extra1',datastore:'pbs3'}];const root=cfg.sources.find(source=>source.id==='filme');root.partitioned=true;
 for(const [id,target]of [['teil-a','secondary'],['teil-b','extra1']]){cfg.sources.push({...root,id,name:'Technischer Teilauftrag '+id,partitioned:false,parentId:'filme',target,selection:[id+'.mp4']});cfg.schedules[id]={days:[],time:''};}
 const original=doc.data.plans[0];doc.data.plans=[{...original,name:'Kinofilme auf erstem Speicher',implementation:'app'},{...original,id:'zweiter-plan',name:'Weitere Filme',target_id:'cloud',implementation:'app'}];doc.mapping={datasets:{docs:'filme'},targets:{pbs:'secondary',cloud:'extra1'}};
 validateImplementation(doc,cfg,{jobs:{},history:{}},{});const view=strategyView(doc,cfg,{jobs:{},history:{}},{});assert.deepEqual(view.external[0].bindings,['pbs:teil-a']);assert.deepEqual(view.external[1].bindings,['pbs:teil-b']);assert.equal(view.external.every(plan=>plan.executionReady),true);
 cfg.sources=cfg.sources.filter(source=>source.id!=='teil-b');assert.throws(()=>validateImplementation(doc,cfg,{jobs:{},history:{}},{}),/kein Teilauftrag auf dem gewählten Ziel/);
});
