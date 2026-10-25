import { installExecutionViews } from '/js/execution.js';
export function installStrategy({api,element,date,scheduleText,notice}) {
 const $=selector=>document.querySelector(selector);
 let snapshot=null, stored=null, preview=null, loading=null, loadedAt=0, calendarMode='week', calendarOffset=0, activeTab='paths', importFile=null;
 // Metadata IDs are not credentials; work on plain HTTP LAN addresses as well.
 const newId=()=> 'entry-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
 const labels={backup:'Sicherung mit Versionen',synchronization:'Synchronisierung',archive:'Archiv',idle:'Noch kein Lauf',queued:'Wartet',running:'Läuft',success:'Erfolgreich',failed:'Fehlgeschlagen',interrupted:'Unterbrochen',cancelled:'Abgebrochen',cancelling:'Abbruch läuft',unverified:'Extern · ungeprüft'};
 const n=(tag,text,cls)=>element(tag,text,cls);
 const busy=job=>['queued','running','cancelling'].includes(job.status);
 const bad=job=>['failed','interrupted'].includes(job.status);
 const link=(text,href,cls='row-action')=>{const a=n('a',text,cls);a.href=href;return a;};
 const button=(text,action,cls='secondary')=>{const b=n('button',text,cls);b.type='button';b.onclick=action;return b;};
 const badge=(text,tone='')=>n('span',text,'badge '+tone);
 const inventoryInfo={sources:['Geräte','QNAP4bay oder PBS: Ein Gerät kann Daten bereitstellen und Speicherziele enthalten.'],datasets:['Daten','Software, Musik oder Filme: Wähle das Gerät, auf dem diese Daten ursprünglich liegen.'],targets:['Speicherziele','pbs2 oder ein Google-Drive-Ordner: Wähle das Gerät bzw. den Dienst, der das Ziel bereitstellt.'],locations:['Standorte','Standort → Gebäude → Raum. Ordne anschließend die Geräte einem Standort zu.'],software:['Software','Optional: Dokumentiere, welches Programm die Sicherung ausführt.'],networks:['Netzwerkbereiche','Optional: Gemeinsame Netzkapazität für die Zeitplanprüfung dokumentieren.']};
 const implementationLabel={planned:'Geplant',app:'Durch App umgesetzt',external:'Extern umgesetzt'};
 const duration=seconds=>seconds==null?'Dauer unbekannt':seconds<60?Math.round(seconds)+' s':seconds<3600?Math.ceil(seconds/60)+' min':Math.floor(seconds/3600)+' h '+Math.round(seconds%3600/60)+' min';
 function feedback(text,error=false){$('#strategyFeedback').textContent=text;$('#strategyFeedback').classList.toggle('row-error',error);}
 function metric(root,items){root.replaceChildren();for(const [value,title,hint]of items){const card=n('article',undefined,'inventory-metric');card.append(n('strong',String(value)),n('span',title),n('small',hint,'hint'));root.append(card);}}
 const execution=installExecutionViews({n,badge,button,link,date,scheduleText,metric,getStored:()=>stored,getSnapshot:()=>snapshot,save});
 function goTab(tab){activeTab=tab;for(const key of ['paths','plans','mapping','inventory'])$('#strategy'+key[0].toUpperCase()+key.slice(1)+'Panel').hidden=key!==tab;document.querySelectorAll('[data-strategy-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.strategyTab===tab)));}
 function renderLivePaths(){
  if(!snapshot)return;
  const root=$('#liveProtectionPaths');root.replaceChildren();
  const parents=snapshot.folders.filter(source=>!source.parentId);
  const order=[...parents].sort((a,b)=>Number(bad(b.job||{}))-Number(bad(a.job||{})));
  for(const source of order.slice(0,6)){
   const row=n('div',undefined,'protection-path'),origin=n('div',undefined,'path-origin');if(execution.sourceDeviceName(source.id))origin.append(n('small',execution.sourceDeviceName(source.id),'path-device'));origin.append(link(source.name,'#sourcesDialog/'+source.id+'/edit'),n('small',source.path,'hint'));row.append(origin,n('span','→','path-arrow'));
   const destinations=n('div',undefined,'path-destinations');
   const sources=source.partitioned?snapshot.folders.filter(item=>item.parentId===source.id):[source];
   for(const item of sources.filter(item=>item.target!=='gdrive')){
    const target=snapshot.targets.find(target=>target.id===(item.target||'primary')),job=item.job||{};
    const chip=link((execution.targetDeviceName(item.target||'primary')?execution.targetDeviceName(item.target||'primary')+' / ':'')+(target?.name||'PBS fehlt')+' · '+(labels[job.status]||'Noch kein Lauf'),'#jobs/'+item.id+'/edit','path-chip '+(bad(job)?'path-bad':busy(job)?'path-busy':job.status==='success'?'path-ok':''));
    chip.title=(target?.repository||'Kein PBS eingerichtet')+' · '+(job.lastSuccess?'Letzter Erfolg: '+date(job.lastSuccess):'Noch kein bestätigter App-Erfolg');destinations.append(chip);
   }
   if(snapshot.config.gdrive.sources.includes(source.id)){
    const result=snapshot.drive.results?.find(item=>item.id===source.id||item.sourceId===source.id),job=result||snapshot.drive;
    const chip=link('Google Drive · '+(labels[job.status]||'Noch kein Lauf'),'#jobs','path-chip '+(bad(job)?'path-bad':busy(job)?'path-busy':job.status==='success'?'path-ok':''));
    chip.title='Google Drive · '+(snapshot.config.gdrive.mode==='backup'?'Sicherung mit Versionen':snapshot.config.gdrive.mode==='sync'?'Abgleich mit Löschen':'Abgleich ohne Löschen');destinations.append(chip);
   }
   if(!destinations.childElementCount)destinations.append(link('Ziel zuordnen','#sourcesDialog/'+source.id+'/edit','path-chip'));
   row.append(destinations);root.append(row);
  }
  if(!parents.length)root.append(n('p','Noch keine Daten. Über „Hinzufügen“ einen eingebundenen Ordner registrieren.','hint'));
  if(parents.length>6)root.append(link('Alle '+parents.length+' Daten öffnen →','#sourcesDialog'));
 }
 function mappingEditor(root,document,mapping={datasets:{},targets:{}}){
  root.replaceChildren();
  if(!snapshot)return;
  for(const kind of ['datasets','targets']){
   const section=n('section',undefined,'mapping-section');section.append(n('h3',kind==='datasets'?'Datenbestand → eingebundener Ordner':'Planner-Ziel → App-Ziel'));
   const grid=n('div',undefined,'mapping-grid');
   for(const item of document.data[kind]){
    const label=n('label',item.name),select=n('select');select.dataset.mapKind=kind;select.dataset.mapId=item.id;select.setAttribute('aria-label','Zuordnung '+item.name);
    const options=kind==='datasets'?snapshot.config.sources.map(source=>({id:source.id,name:source.name+' · '+source.path})):[...snapshot.targets.filter(target=>target.repository),{id:'gdrive',name:'Google Drive'}];
    const empty=n('option','Extern / noch nicht verbunden');empty.value='';select.append(empty);
    for(const option of options){const node=n('option',option.name);node.value=option.id;select.append(node);}select.value=mapping[kind]?.[item.id]||'';if(!select.value)select.value='';label.append(select);grid.append(label);
   }
   if(!document.data[kind].length)grid.append(n('p','Noch keine Einträge. Erst importieren oder unter Geräte, Daten & Ziele anlegen.','hint'));
   section.append(grid);root.append(section);
  }
 }
 function readMapping(root){const mapping={datasets:{},targets:{}};root.querySelectorAll('select[data-map-kind]').forEach(select=>{if(select.value)mapping[select.dataset.mapKind][select.dataset.mapId]=select.value;});return mapping;}
 async function load(force=false){
  if(!snapshot)return;
  if(loading)return force?loading.then(()=>load(true)):loading;
  if(!force&&stored&&Date.now()-loadedAt<10000)return;
  loading=(async()=>{try{
   const at=new Date();at.setUTCDate(at.getUTCDate()+calendarOffset*7);
   let zoneDay=new Intl.DateTimeFormat('sv-SE',{timeZone:snapshot.config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
   const monday=new Date(zoneDay+'T12:00:00Z');monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);zoneDay=monday.toISOString().slice(0,10);
   stored=await api('/api/strategy?week='+zoneDay);loadedAt=Date.now();render();
  }catch(error){feedback(error.message,true);}finally{loading=null;}})();
  return loading;
 }
 async function save(document,mapping,revision=stored.revision){
  await api('/api/strategy/save',{document,mapping,revision});await load(true);feedback('Backup-Planung gespeichert. App-Aufträge und Zeitpläne bleiben unverändert.');
 }
 function renderPaths(){
  const root=$('#strategyPaths');root.replaceChildren();
  const d=stored.document.data,view=stored.view;
  if(!d.datasets.length){const empty=n('div',undefined,'workspace-empty');empty.append(n('h3','Deine Backup-Planung beginnt hier'),n('p','Alles lässt sich direkt hier anlegen und bearbeiten: zuerst Geräte anlegen, dann Daten und Speicherziele zuordnen, danach den Backup-Plan erstellen. Geräte, Daten und Speicherziele werden gemeinsam verwaltet; eingebundene Ordner findest du auch unter Daten.'),button('Geräte und Daten anlegen',()=>{goTab('inventory');$('#inventoryKind').value='sources';renderInventory();editEntity('sources');},'primary'),button('Vorhandenen Planner importieren',()=>{$('#strategyImport').hidden=false;$('#plannerFile').focus();},'secondary'));root.append(empty);return;}
  for(const dataset of d.datasets){
   const card=n('section',undefined,'dataset-paths'),heading=n('div',undefined,'panel-title');heading.append(n('h3',dataset.name),badge(dataset.priority==='high'?'Hohe Priorität':dataset.priority==='low'?'Niedrige Priorität':'Normale Priorität'));card.append(heading);
   const plans=d.plans.filter(plan=>plan.dataset_ids.includes(dataset.id));
   for(const plan of plans){
    const origin=d.sources.find(item=>item.id===plan.source_id),via=d.targets.find(item=>item.id===plan.source_target_id),target=d.targets.find(item=>item.id===plan.target_id),row=n('div',undefined,'strategy-path');
    row.append(n('span',origin.name,'path-chip'));
    if(via)row.append(n('span','→','path-arrow'),n('span',via.name,'path-chip'));
    if(target.device_id){const device=d.sources.find(item=>item.id===target.device_id);if(device)row.append(n('span','→','path-arrow'),n('span',device.name,'path-chip'));}
    row.append(n('span','→','path-arrow'),button(target.name,()=>editPlan(plan.id),'path-chip'),badge(labels[plan.protection_type]));
    const external=view.external.find(item=>item.planId===plan.id),linked=external.bindings.length;
    row.append(badge(external.implementation==='app'&&!external.executionReady?'App-Zuordnung fehlt':implementationLabel[external.implementation],external.implementation==='external'?'external-ready':external.implementation==='app'&&external.executionReady?'ok':'external'));
    const note=button(external.implementation==='app'&&!external.executionReady?'App-Verknüpfung fehlt':linked?'Mit '+linked+' App-Auftrag verbunden':external.implementation==='external'?external.executor+' · Laufstatus nicht abgefragt':'Geplant · noch nicht eingerichtet',()=>editPlan(plan.id),'row-action');row.append(note);card.append(row);
   }
   if(!plans.length)card.append(n('p','Noch kein Sicherungsweg geplant.','strategy-warning'));
   const mapped=stored.document.mapping.datasets[dataset.id];card.append(n('p',mapped?'App-Quelle: '+(snapshot.config.sources.find(item=>item.id===mapped)?.name||'Zuordnung nicht mehr vorhanden'):'Noch keiner eingebundenen App-Quelle zugeordnet.','hint'));root.append(card);
  }
 }
 function renderInventory(){
  const kind=$('#inventoryKind').value,root=$('#strategyInventory');root.replaceChildren();
  const categories=$('#inventoryCategories');categories.replaceChildren();for(const [key,[title]]of Object.entries(inventoryInfo)){const tab=button(title+' · '+stored.document.data[key].length,()=>{$('#inventoryKind').value=key;$('#strategyEditor').hidden=true;renderInventory();});tab.dataset.inventoryKind=key;tab.setAttribute('aria-pressed',String(kind===key));categories.append(tab);}
  $('#inventoryDescription').textContent=inventoryInfo[kind][1];$('#inventoryAdd').textContent='+ Eintrag';$('#inventoryAdd').setAttribute('aria-label',inventoryInfo[kind][0]+' hinzufügen');
  let rows=stored.document.data[kind];const depths=new Map();if(kind==='locations'){const ordered=[];function visit(parent,depth){for(const row of rows.filter(row=>(row.parent_id||null)===parent).sort((a,b)=>a.name.localeCompare(b.name,'de'))){depths.set(row.id,depth);ordered.push(row);visit(row.id,depth+1);}}visit(null,0);rows=ordered;}
  if(!rows.length){root.append(n('p','Noch keine '+inventoryInfo[kind][0]+'. Über „+ Eintrag“ hinzufügen.','workspace-empty'));return;}
  const table=n('table'),head=n('thead'),tr=n('tr');for(const title of ['Name','Zuordnung / Typ','Aktionen'])tr.append(n('th',title));head.append(tr);table.append(head);const body=n('tbody');
  for(const item of rows){const row=n('tr'),name=n('td'),relation=n('td'),actions=n('td');const title=n('strong',(depths.get(item.id)>0?'↳ ':'')+item.name);if(kind==='locations')title.style.marginInlineStart=(depths.get(item.id)*18)+'px';name.append(title);if(item.notes)name.append(n('small',item.notes,'hint'));
   const location=stored.document.data.locations.find(loc=>loc.id===(item.parent_id||item.location_id));const source=stored.document.data.sources.find(source=>source.id===item.source_id);
   const device=stored.document.data.sources.find(device=>device.id===item.device_id);const type=item.storage_type||item.device_type||item.type;relation.textContent=[device?.name||source?.name,location?.name].filter(Boolean).join(' · ')||({country:'Land',site:'Standort',building:'Gebäude',room:'Raum',cloud:'Cloud',server:'Server',nas:'NAS','external-disk':'Externe Festplatte'})[type]||type||'—';
   actions.append(button('Bearbeiten',()=>editEntity(kind,item.id),'row-action'),button('Entfernen',()=>confirmDelete(kind,item.id),'row-action'));row.append(name,relation,actions);body.append(row);
  }table.append(body);const wrap=n('div',undefined,'strategy-table');wrap.append(table);root.append(wrap);
 }
 function renderPlanList(){
  const root=$('#planningPlanList');root.replaceChildren();
  const query=$('#planningSearch').value.trim().toLocaleLowerCase('de');
  const table=n('table'),head=n('thead'),heading=n('tr');
  for(const title of ['Name / Datenbestände','Quelle','Ziel','Umsetzung','Zeitplan','Aktionen'])heading.append(n('th',title));head.append(heading);table.append(head);const body=n('tbody');
  for(const job of stored.view.external){
   if(query&&![job.name,job.source,job.target,...job.datasetNames].join(' ').toLocaleLowerCase('de').includes(query))continue;
   const row=n('tr');row.dataset.planId=job.planId;
   const name=n('td');const title=n('strong',job.name);title.style.borderLeft='3px solid '+(stored.document.data.plans.find(plan=>plan.id===job.planId)?.color||'#8051b8');title.style.paddingLeft='8px';name.append(title,n('small',job.datasetNames.join(', '),'hint'));
   const source=n('td',job.source),target=n('td',job.target),kind=n('td');kind.append(badge(job.implementation==='app'&&!job.executionReady?'App-Zuordnung fehlt':implementationLabel[job.implementation],job.implementation==='external'?'external-ready':job.implementation==='app'&&job.executionReady?'ok':'external'),n('small',job.implementation==='app'&&!job.executionReady?'App-Verknüpfung fehlt':job.executor||labels[job.protection],'hint'));
   const plan=n('td',job.implementation==='app'&&job.executionReady?job.appSchedules.map(item=>scheduleText(item.schedule)).join(' / '):scheduleText(job.schedule)),actions=n('td');
   actions.append(button('Bearbeiten',()=>editPlan(job.planId),'row-action'),button('Entfernen',()=>confirmDelete('plans',job.planId),'row-action'));
   row.append(name,source,target,kind,plan,actions);body.append(row);
  }
  table.append(body);root.append(table);if(!body.children.length)root.append(n('p',query?'Keine passenden Pläne.':'Noch keine Pläne. Über „Neuer Backup-Plan“ einen Sicherungsweg anlegen.','workspace-empty'));
 }
 function filterJobs(){
  if(!snapshot)return;
  const query=$('#jobSearch').value.toLocaleLowerCase('de'),management=$('#jobManagement').value,filter=$('#jobState').value;
  const rows=[...$('#folders').children,...$('#operatingExternalRows').children,...$('#driveJobRows').children];
  let total=0;
  for(const row of rows){
   const external=Boolean(row.dataset.externalJob),drive=row.id==='driveOverview',id=row.dataset.folder;
   if(drive&&!snapshot.config.gdrive.sources.length){row.hidden=true;continue;}
   total++;
   const status=external?'unverified':drive?snapshot.drive.status:snapshot.folders.find(folder=>folder.id===id)?.job.status;
   row.hidden=Boolean(query&&!row.textContent.toLocaleLowerCase('de').includes(query)||management==='pbs'&&(drive||external)||management==='gdrive'&&!drive||management==='external'&&!external||filter==='busy'&&!['queued','running','cancelling'].includes(status)||filter==='failed'&&!['failed','interrupted'].includes(status));
  }
  $('#jobCount').textContent=String(total);$('#jobEmpty').hidden=total>0;
  metric($('#jobMetrics'),[[total,'Eingerichtete Sicherungen','App-Aufträge und extern eingerichtete Backups'],[snapshot.folders.filter(folder=>busy(folder.job||{})).length+Number(busy(snapshot.drive)),'Aktiv / wartend','Aktueller Laufstatus'],[snapshot.folders.filter(folder=>bad(folder.job||{})).length+Number(bad(snapshot.drive)),'Fehler / unterbrochen','Protokoll für Details öffnen']]);
 }
 function renderCalendar(){
  if(!stored)return;execution.network();
  const view=stored.view,filter=$('#calendarFilter').value;$('#schedule').classList.toggle('show-planning',['planned','all'].includes(filter));const all=[...view.jobs,...view.external.filter(job=>job.implementation!=='app')],jobs=all.filter(job=>filter==='all'||filter==='app'&&job.engine!=='external'||filter==='external'&&job.engine==='external'&&job.implementation==='external'||filter==='planned'&&job.implementation==='planned'||filter==='operating'&&job.implementation!=='planned');
  const index=new Map(jobs.map(job=>[job.id,job]));
  const root=$('#unifiedCalendar');root.replaceChildren();const format=t=>new Intl.DateTimeFormat('de-DE',{timeZone:view.timezone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
  $('#calendarDates').textContent=format(view.days[0].start).split(',')[0]+' – '+format(view.days.at(-1).start).split(',')[0];
  $('#calendarSummary').textContent=view.timezone+' · '+jobs.filter(job=>job.engine!=='external').length+' App-Aufträge · '+jobs.filter(job=>job.engine==='external'&&job.implementation==='external').length+' extern eingerichtete Backups · '+jobs.filter(job=>job.implementation==='planned').length+' geplante Sicherungen · manuelle Aufträge haben keinen Termin';
  if(calendarMode==='agenda'){
   const events=view.events.filter(event=>index.has(event.jobId)).sort((a,b)=>a.start-b.start);
   for(const event of events){const job=index.get(event.jobId),row=button('',()=>openJob(job),'agenda-row');row.append(n('strong',format(event.start)),n('span',job.name+' · '+job.source+' → '+job.target),badge(job.engine==='external'?(job.implementation==='external'?'Extern · '+job.executor:'Geplant'):job.durationKind==='measured'?'Dauer gemessen':'Dauer unbekannt'),n('small',duration(job.seconds),'hint'));root.append(row);}
   if(!events.length)root.append(n('p','Keine Termine in diesem Zeitraum. Unter Aufträge einen Zeitplan einrichten.','workspace-empty'));return;
  }
  const grid=n('div',undefined,'week-calendar'),header=n('div',undefined,'week-header');header.append(n('span','Tag / Stunde'));for(let hour=0;hour<24;hour++)header.append(n('span',String(hour).padStart(2,'0')));grid.append(header);
  for(const day of view.days){
   const row=n('div',undefined,'week-row'),label=n('div',undefined,'week-day');label.append(n('strong',new Intl.DateTimeFormat('de-DE',{timeZone:view.timezone,weekday:'short',day:'2-digit',month:'2-digit'}).format(new Date(day.start))));const hours=(day.end-day.start)/3600000;if(hours!==24)label.append(n('small',hours+' h · Zeitumstellung','hint'));row.append(label);
   const track=n('div',undefined,'week-track'),events=view.events.filter(event=>index.has(event.jobId)&&event.start<day.end&&(event.end==null?event.start>=day.start:event.end>day.start)).sort((a,b)=>a.start-b.start),lanes=[];
   for(const event of events){
    const job=index.get(event.jobId),start=Math.max(day.start,event.start),end=Math.min(day.end,event.end??event.start+60000);
    const point=event.end==null,startPercent=(start-day.start)/(day.end-day.start)*100,width=Math.max(.6,(end-start)/(day.end-day.start)*100);
    let lane=lanes.findIndex(last=>last<=startPercent);if(lane<0)lane=lanes.length;lanes[lane]=startPercent+Math.max(width,2);
    const bar=button('',()=>openJob(job),'calendar-bar '+(job.engine==='external'?(job.implementation==='external'?'calendar-external-ready':'calendar-external'):job.engine==='gdrive'?'calendar-drive':'calendar-pbs')+(point?' calendar-point':''));
    const description=(job.implementation==='external'?'Extern eingerichtet · '+job.executor+' · ':job.implementation==='planned'?'Geplant · ':'App · ')+job.name+' · '+job.source+' → '+job.target+' · '+format(event.start)+' · '+duration(job.seconds)+' · '+(job.durationKind==='planned'?'geplante Dauer':job.durationKind==='measured'?'zuletzt gemessene Dauer':'Dauer unbekannt');
    bar.title=description;bar.setAttribute('aria-label',description);bar.textContent=point?'':job.name;bar.style.left=startPercent+'%';bar.style.width=width+'%';bar.style.top=(lane*38+9)+'px';track.append(bar);
   }
   track.style.height=Math.max(62,lanes.length*38+18)+'px';
   if(view.now>=day.start&&view.now<day.end){const marker=n('span',undefined,'calendar-now');marker.style.left=(view.now-day.start)/(day.end-day.start)*100+'%';marker.title='Jetzt';track.append(marker);}
   row.append(track);grid.append(row);
  }root.append(grid);
 }
 function openJob(job){if(job.engine==='external'){location.hash='strategy/plan/'+job.planId;}else if(job.engine==='gdrive'){location.hash='targets';$('#driveSettings').open=true;$('#driveSettings').scrollIntoView({block:'start'});}else location.hash=job.edit;}
 function render(){
  if(!stored)return;
  const d=stored.document.data;
  metric($('#strategyMetrics'),[[d.plans.filter(plan=>plan.implementation==='planned').length,'Noch geplant','Noch nicht als eingerichtet bestätigt'],[stored.view.external.filter(plan=>plan.executionReady).length,'Umsetzung dokumentiert','App-verknüpft oder extern eingerichtet'],[d.datasets.length,'Datenbestände',d.sources.length+' Quellgeräte'],[d.locations.length,'Standorte','Gemeinsame Ausfallbereiche beachten']]);
  renderLivePaths();renderPaths();renderInventory();renderPlanList();renderCalendar();execution.render();filterJobs();
  // Preserve unsaved mapping selections during background refreshes.
  if(!$('#strategyMapping').dataset.dirty)mappingEditor($('#strategyMapping'),stored.document,stored.document.mapping);
 }
 function editor(title){const root=$('#strategyEditor');root.hidden=false;root.replaceChildren();const heading=n('div',undefined,'panel-title');heading.append(n('h2',title),button('Schließen',()=>{root.hidden=true;}));root.append(heading);return root;}
 function field(form,title,name,value,options){
  const label=n('label',title),input=n(options?'select':'input');input.name=name;input.setAttribute('aria-label',title);
  if(options)for(const option of options){const node=n('option',option.name);node.value=option.id;input.append(node);}
  if(options&&value&&!options.some(option=>String(option.id)===String(value))){const extra=n('option',String(value));extra.value=value;input.append(extra);}
  input.value=value??'';label.append(input);form.append(label);return input;
 }
 function errorBox(form){const result=n('p','','hint');result.setAttribute('role','status');form.append(result);return result;}
 function editPlan(identifier,presetDataset){
  if(!stored)return;
  const previous=stored.document.data.plans.find(plan=>plan.id===identifier),root=editor(previous?'Backup-Plan bearbeiten':'Backup-Plan anlegen'),form=n('form'),grid=n('div',undefined,'editor-grid');
  const missing=[['sources','Gerät anlegen'],['datasets','Daten zuordnen'],['targets','Speicherziel anlegen']].filter(([key])=>!stored.document.data[key].length);if(missing.length){root.append(n('p','Für den ersten Backup-Plan fehlen noch diese Angaben:','hint'));for(const [key,title]of missing)root.append(link(title,'#strategy/entity/'+key+'~','secondary'));root.scrollIntoView({block:'start'});return;}
  root.append(n('p','Sicherungsweg und Umsetzung dokumentieren. Geplant: noch nicht eingerichtet. Extern: wird im angegebenen System ausgeführt. App: mit passenden vorhandenen App-Aufträgen verbinden. Speichern startet keine Sicherung.','hint'),form);form.append(grid);
  const p=previous||{name:'',source_id:stored.document.data.sources[0]?.id,target_id:stored.document.data.targets[0]?.id,protection_type:'backup',schedule_type:'manual',weekdays:[],day_of_month:1,start_time:'02:00',duration_minutes:0,dataset_ids:[],notes:''};
  if(!previous&&presetDataset){const dataset=stored.document.data.datasets.find(item=>item.id===presetDataset);if(dataset){p.source_id=dataset.source_id;p.dataset_ids=[dataset.id];p.name=dataset.name+' sichern';}}
  field(grid,'Name','name',p.name).required=true;
  const implementation=field(grid,'Umsetzung','implementation',p.implementation||'planned',[{id:'planned',name:'Geplant · noch nicht eingerichtet'},{id:'external',name:'Extern umgesetzt'},{id:'app',name:'Durch diese App umgesetzt'}]);
  const executor=field(grid,'Ausführendes System','executor',p.executor||'');executor.placeholder='z. B. Proxmox pve · Datacenter → Backup';
  const source=field(grid,'Ursprüngliches Quellgerät','source_id',p.source_id,stored.document.data.sources);
  field(grid,'Ziel','target_id',p.target_id,stored.document.data.targets.map(target=>({...target,name:(stored.document.data.sources.find(device=>device.id===target.device_id)?.name?stored.document.data.sources.find(device=>device.id===target.device_id).name+' / ':'')+target.name})));
  field(grid,'Software (optional)','software_id',p.software_id||'',[{id:'',name:'Nicht festgelegt'},...stored.document.data.software]);
  field(grid,'Über vorhandene Kopie (optional)','source_target_id',p.source_target_id||'',[{id:'',name:'Direkt von der Quelle'},...stored.document.data.targets]);
  field(grid,'Schutzart','protection_type',p.protection_type,[{id:'backup',name:'Sicherung mit Versionen'},{id:'synchronization',name:'Synchronisierung'},{id:'archive',name:'Archiv'}]);
  field(grid,'Frequenz','schedule_type',p.schedule_type,[{id:'manual',name:'Nur manuell'},{id:'daily',name:'Täglich'},{id:'weekly',name:'Wöchentlich'},{id:'monthly',name:'Monatlich'}]);
  field(grid,'Uhrzeit','start_time',p.start_time||'02:00').type='time';field(grid,'Monatstag','day_of_month',p.day_of_month,Array.from({length:31},(_,i)=>({id:String(i+1),name:String(i+1)})).concat({id:'last',name:'Letzter Tag'}));
  const time=field(grid,'Geplante Dauer (Minuten, 0 = unbekannt)','duration_minutes',p.duration_minutes);time.type='number';time.min='0';time.max='525600';
  field(grid,'Notizen','notes',p.notes||'');
  const days=n('fieldset'),dayLegend=n('legend','Wochentage');days.append(dayLegend);const dayInputs=[];
  ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach((day,index)=>{const label=n('label',day,'checkbox-label'),input=n('input');input.type='checkbox';input.value=index+1;input.checked=(p.weekdays||[]).includes(index+1);dayInputs.push(input);label.prepend(input);days.append(label);});form.append(days);
  const datasetBox=n('fieldset');datasetBox.append(n('legend','Datenbestände des Quellgeräts'));form.append(datasetBox);
  function paintDatasets(){datasetBox.querySelectorAll('label').forEach(label=>label.remove());for(const dataset of stored.document.data.datasets.filter(dataset=>dataset.source_id===source.value)){const label=n('label',dataset.name,'checkbox-label'),input=n('input');input.type='checkbox';input.value=dataset.id;input.checked=(p.dataset_ids||[]).includes(dataset.id);label.prepend(input);datasetBox.append(label);}}
  source.onchange=()=>{paintDatasets();if(typeof paintAppMapping==='function')paintAppMapping();};paintDatasets();
  function frequency(){const mode=form.elements.schedule_type.value;days.hidden=mode!=='weekly';form.elements.day_of_month.closest('label').hidden=mode!=='monthly';form.elements.start_time.disabled=mode==='manual';}
  form.elements.schedule_type.onchange=frequency;frequency();
  const appBox=n('fieldset');appBox.append(n('legend','Verbindung zur tatsächlichen App-Umsetzung'));form.append(appBox);
  const appMapping=n('div',undefined,'mapping-grid'),appSchedules=n('div',undefined,'app-schedules');appBox.append(n('p','Datenbestände und Ziel ausdrücklich zuordnen. Quelle und Ziel müssen bereits als passende App-Aufträge eingerichtet sein. Deren tatsächlicher Zeitplan bleibt maßgeblich.','hint'),appMapping,appSchedules);
  const draftMapping=structuredClone(stored.document.mapping);
  function paintAppMapping(){
   appMapping.querySelectorAll('select[data-map-kind]').forEach(select=>{draftMapping[select.dataset.mapKind][select.dataset.mapId]=select.value;});
   const selected=[...datasetBox.querySelectorAll('input:checked')].map(input=>input.value);
   mappingEditor(appMapping,{data:{datasets:stored.document.data.datasets.filter(dataset=>selected.includes(dataset.id)),targets:stored.document.data.targets.filter(target=>target.id===form.elements.target_id.value)}},draftMapping);
   paintAppSchedules();
  }
  function paintAppSchedules(){const selected=readMapping(appMapping);appSchedules.replaceChildren();const candidates=stored.view.jobs.filter(job=>job.targetId===selected.targets[form.elements.target_id.value]&&Object.values(selected.datasets).some(id=>job.sourceId===id||job.rootId===id||job.sourceIds?.includes(id)));for(const job of candidates)appSchedules.append(link(job.name+' → '+job.target+' · '+scheduleText(job.schedule),job.edit));if(!candidates.length)appSchedules.append(n('p','Noch kein passender App-Auftrag. Quelle und Ziel zuerst einrichten oder diesen Weg vorerst als geplant speichern.','hint'));appSchedules.append(link('Quelle über Assistent einrichten','#assistant/source'),link('App-Ziele einrichten','#targets'));}
  appMapping.addEventListener('change',paintAppSchedules);
  datasetBox.addEventListener('change',paintAppMapping);form.elements.target_id.addEventListener('change',paintAppMapping);
  function implementationChanged(){
   const app=implementation.value==='app';appBox.hidden=!app;executor.closest('label').hidden=implementation.value!=='external';executor.required=implementation.value==='external';
   for(const key of ['schedule_type','start_time','day_of_month','duration_minutes'])form.elements[key].closest('label').hidden=app||key==='day_of_month'&&form.elements.schedule_type.value!=='monthly';
   days.hidden=app||form.elements.schedule_type.value!=='weekly';if(app)paintAppMapping();
  }
  implementation.onchange=implementationChanged;implementationChanged();
  const networkBox=n('details');networkBox.className='advanced';networkBox.append(n('summary','Netzwerk & erwartete Last'));const networkGrid=n('div',undefined,'editor-grid');networkBox.append(networkGrid);form.append(networkBox);
  field(networkGrid,'Netzwerkbereich','network_id',p.network_id||'',[{id:'',name:'Noch nicht zugeordnet'},...(stored.document.data.networks||[])]);
  const bandwidth=field(networkGrid,'Erwartete Bandbreite (MiB/s, leer = unbekannt)','bandwidth_mib',p.bandwidth_mib??'');bandwidth.type='number';bandwidth.min='0.01';bandwidth.max='100000';bandwidth.step='0.01';networkBox.append(n('p','Eine Schätzung für die gemeinsame Lastprüfung. Kein Upload-Limit und keine Live-Messung. Netzwerkbereiche samt Kapazität unter Geräte, Daten & Ziele anlegen.','hint'));
  const advanced=n('details');advanced.className='advanced';advanced.append(n('summary','Aufbewahrung & Verantwortung · Dokumentation'));const extra=n('div',undefined,'editor-grid');advanced.append(extra);form.append(advanced);
  const retention=field(extra,'Aufbewahrung (leer = nicht dokumentiert)','retention_value',p.retention_value??'');retention.type='number';retention.min='0';retention.max='1000000';
  field(extra,'Einheit','retention_unit',p.retention_unit||'days',[{id:'days',name:'Tage'},{id:'weeks',name:'Wochen'},{id:'months',name:'Monate'},{id:'years',name:'Jahre'}]);
  const versions=field(extra,'Versionen (0 = nicht dokumentiert)','version_count',p.version_count||0);versions.type='number';versions.min='0';versions.max='100000';field(extra,'Verantwortlich','owner',p.owner||'');field(extra,'Farbe im Plan','color',p.color||'#3978ed').type='color';
  for(const [key,title]of [['encrypted','Verschlüsselung dokumentiert'],['immutable','Unveränderlichkeit dokumentiert']]){const label=n('label',title,'checkbox-label'),input=n('input');input.type='checkbox';input.name=key;input.checked=Boolean(p[key]);label.prepend(input);extra.append(label);}
  advanced.append(n('p','Diese Angaben beschreiben die externe Konfiguration. Die App stellt keine Aufbewahrung, Verschlüsselung oder Unveränderlichkeit am Ziel ein.','hint'));
  const submit=n('button','Plan speichern','primary');submit.type='submit';form.append(submit);if(previous)form.append(button('Plan entfernen',()=>confirmDelete('plans',identifier),'secondary'));
  const result=errorBox(form);
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{
   const values=Object.fromEntries(new FormData(form));const next={...p,...values,id:previous?.id||newId(),active:1,day_of_month:values.day_of_month==='last'?'last':Number(values.day_of_month),weekdays:dayInputs.filter(input=>input.checked).map(input=>Number(input.value)),duration_minutes:Number(values.duration_minutes),dataset_ids:[...datasetBox.querySelectorAll('input:checked')].map(input=>input.value),software_id:values.software_id||null,retention_value:values.retention_value===''?null:Number(values.retention_value),version_count:Number(values.version_count),encrypted:form.elements.encrypted.checked?1:0,immutable:form.elements.immutable.checked?1:0,network_id:values.network_id||null,bandwidth_mib:values.bandwidth_mib===''?null:Number(values.bandwidth_mib)};
   if(!next.source_id||!next.target_id)throw Error('Zuerst unter Geräte, Daten & Ziele ein Quellgerät und ein Ziel anlegen.');if(!next.dataset_ids.length)throw Error('Mindestens einen Datenbestand auswählen.');
   const doc=structuredClone(stored.document);if(next.implementation==='app'){const selected=readMapping(appMapping);for(const dataset of next.dataset_ids)delete doc.mapping.datasets[dataset];delete doc.mapping.targets[next.target_id];doc.mapping={...doc.mapping,datasets:{...doc.mapping.datasets,...selected.datasets},targets:{...doc.mapping.targets,...selected.targets}};}doc.data.plans=previous?doc.data.plans.map(plan=>plan.id===identifier?next:plan):[...doc.data.plans,next];await save(doc,doc.mapping);root.hidden=true;
  }catch(error){result.textContent=error.message;}finally{submit.disabled=false;}};
  root.scrollIntoView({block:'start',behavior:'smooth'});
 }
 function editEntity(kind,identifier){
  if(!stored){feedback('Die Planung konnte noch nicht geladen werden. Bitte aktualisieren; die vorhandenen Daten bleiben erhalten.',true);return;}const previous=stored.document.data[kind].find(row=>row.id===identifier),root=editor(previous?'Strategieeintrag bearbeiten':'Strategieeintrag anlegen'),form=n('form');form.className='editor-grid';root.append(n('p',inventoryInfo[kind][1],'hint'),form);
  const item=previous||{id:newId(),name:'',notes:'',active:1};if(kind==='targets')root.append(n('p','Das Ziel ist der konkrete Speicherort, z. B. Datastore pbs2 oder ein Cloud-Ordner. Der bereitstellende Server bzw. Dienst wird separat als Gerät zugeordnet.','hint'));field(form,'Name','name',item.name).required=true;
  if(['sources','targets'].includes(kind))field(form,'Standort','location_id',item.location_id||'',[{id:'',name:'Nicht festgelegt'},...stored.document.data.locations]);
  if(kind==='locations'){field(form,'Übergeordneter Standort','parent_id',item.parent_id||'',[{id:'',name:'Keiner'},...stored.document.data.locations.filter(row=>row.id!==identifier)]);field(form,'Typ','type',item.type||'site',[{id:'country',name:'Land'},{id:'site',name:'Standort'},{id:'building',name:'Gebäude'},{id:'room',name:'Raum'},{id:'cloud',name:'Cloud'}]);}
  if(kind==='sources')field(form,'Gerätetyp','device_type',item.device_type||'nas',[{id:'nas',name:'NAS'},{id:'server',name:'Server'},{id:'computer',name:'Computer'},{id:'other',name:'Andere'}]);
  if(kind==='targets'){field(form,'Gerät des Ziels','device_id',item.device_id||'',[{id:'',name:'Noch nicht zugeordnet'},...stored.document.data.sources]);field(form,'Speichertyp','storage_type',item.storage_type||'server',[{id:'server',name:'Server'},{id:'nas',name:'NAS'},{id:'cloud',name:'Cloud'},{id:'external-disk',name:'Externe Festplatte'},{id:'other',name:'Andere'}]);field(form,'Anbieter / Gerät','provider',item.provider||'');field(form,'Zielfarbe','color',item.color||'#3978ed').type='color';for(const [key,title]of [['immutable_capable','Unveränderliche Sicherung möglich'],['encrypted_default','Verschlüsselung vorgesehen']]){const label=n('label',title,'checkbox-label'),input=n('input');input.type='checkbox';input.name=key;input.checked=Boolean(item[key]);label.prepend(input);form.append(label);}}
  if(kind==='datasets'){if(!stored.document.data.sources.length)form.append(link('Zuerst ein Quellgerät dokumentieren','#strategy/entity/sources~'));field(form,'Ursprüngliches Quellgerät','source_id',item.source_id||'',stored.document.data.sources);field(form,'Priorität','priority',item.priority||'normal',[{id:'high',name:'Hoch'},{id:'normal',name:'Normal'},{id:'low',name:'Niedrig'}]);}
  if(kind==='networks'){const capacity=field(form,'Nutzbare Kapazität (MiB/s, leer = unbekannt)','capacity_mib',item.capacity_mib??'');capacity.type='number';capacity.min='0.01';capacity.max='100000';capacity.step='0.01';form.append(n('p','Beispiel: 100 MiB/s nutzbar im LAN. Für Internet-Uplink eine eigene Gruppe anlegen. Die App prüft erwartete Last, verändert aber keine Netzwerkregeln.','hint'));}
  field(form,'Notizen','notes',item.notes);const submit=n('button','Eintrag speichern','primary');submit.type='submit';form.append(submit);const result=errorBox(form);
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{const next={...item,...Object.fromEntries(new FormData(form))};if(kind==='networks')next.capacity_mib=next.capacity_mib===''?null:Number(next.capacity_mib);if(kind==='targets')for(const key of ['immutable_capable','encrypted_default'])next[key]=form.elements[key].checked?1:0;const doc=structuredClone(stored.document);doc.data[kind]=previous?doc.data[kind].map(row=>row.id===identifier?next:row):[...doc.data[kind],next];await save(doc,doc.mapping);root.hidden=true;}catch(error){result.textContent=error.message;}finally{submit.disabled=false;}};
  root.scrollIntoView({block:'start',behavior:'smooth'});
 }
 function confirmDelete(kind,identifier){
  const item=stored.document.data[kind].find(row=>row.id===identifier),root=editor('Eintrag entfernen');root.append(n('p',`„${item.name}“ aus der Strategie entfernen? Quelldateien und App-Aufträge bleiben erhalten. Verwendete Einträge können erst nach ihren Verknüpfungen entfernt werden.`));
  const result=n('p','','hint');root.append(button('Entfernen bestätigen',async()=>{try{const doc=structuredClone(stored.document);doc.data[kind]=doc.data[kind].filter(row=>row.id!==identifier);if(kind==='datasets'||kind==='targets')delete doc.mapping[kind][identifier];await save(doc,doc.mapping);root.hidden=true;}catch(error){result.textContent=error.message;}},'primary'),button('Abbrechen',()=>{root.hidden=true;}),result);root.scrollIntoView({block:'start'});
 }
 $('#plannerFile').onchange=()=>{preview=null;importFile=null;$('#plannerApply').hidden=true;$('#plannerConfirmLabel').hidden=true;$('#plannerConfirm').checked=false;$('#plannerPreviewResult').textContent='';$('#plannerImportMapping').replaceChildren();$('#plannerMappingDetails').hidden=true;};
 $('#strategyImportOpen').onclick=()=>{$('#strategyImport').hidden=false;$('#plannerFile').focus();};$('#strategyImportClose').onclick=()=>{$('#strategyImport').hidden=true;};
 $('#plannerPreview').onclick=async()=>{const button=$('#plannerPreview');button.disabled=true;try{
  const file=$('#plannerFile').files[0];if(!file)throw Error('Eine Planner-JSON-Datei auswählen.');if(file.size>4*1024*1024)throw Error('Datei ist größer als 4 MiB.');
  importFile=JSON.parse(await file.text());preview=await api('/api/strategy/preview',{document:importFile});
  $('#plannerPreviewResult').textContent=`${preview.counts.plans} aktive Pläne · ${preview.counts.datasets} Datenbestände · ${preview.counts.targets} Ziele · ${preview.counts.locations} Standorte. ${preview.warnings.join(' ')}`;
  mappingEditor($('#plannerImportMapping'),preview.document,importFile.mapping||{datasets:{},targets:{}});$('#plannerMappingDetails').hidden=false;$('#plannerMappingDetails').open=false;$('#plannerConfirmLabel').hidden=false;$('#plannerConfirm').checked=false;$('#plannerApply').hidden=false;
 }catch(error){preview=null;$('#plannerApply').hidden=true;$('#plannerPreviewResult').textContent=error.message;}finally{button.disabled=false;}};
 $('#plannerApply').onclick=async()=>{if(!preview||!$('#plannerConfirm').checked){$('#plannerPreviewResult').textContent='Vorschau prüfen und Übernahme bestätigen.';return;}const button=$('#plannerApply');button.disabled=true;try{await api('/api/strategy/import',{document:preview.document,mapping:{...(importFile.mapping||{}),...readMapping($('#plannerImportMapping'))},revision:preview.revision});$('#strategyImport').hidden=true;preview=null;await load(true);feedback('Planner importiert. Nur Strategie-Metadaten übernommen; keine Sicherung gestartet.');}catch(error){$('#plannerPreviewResult').textContent=error.message;}finally{button.disabled=false;}};
 $('#strategyMapping').onchange=()=>{$('#strategyMapping').dataset.dirty='true';};
 $('#strategyMappingSave').onclick=async()=>{try{await save(stored.document,{...stored.document.mapping,...readMapping($('#strategyMapping'))});delete $('#strategyMapping').dataset.dirty;mappingEditor($('#strategyMapping'),stored.document,stored.document.mapping);}catch(error){feedback(error.message,true);}};
 $('#strategyExport').onclick=()=>{if(!stored)return;const blob=new Blob([JSON.stringify(stored.document,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=link('','');a.href=url;a.download='backup-strategy-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 document.querySelectorAll('[data-strategy-tab]').forEach(b=>b.onclick=()=>goTab(b.dataset.strategyTab));
 $('#inventoryPlanAdd').onclick=()=>{goTab('plans');editPlan();};
 $('#planningSearch').oninput=()=>{if(stored)renderPlanList();};$('#planningPlanAdd').onclick=()=>editPlan();$('#inventoryKind').onchange=renderInventory;$('#inventoryAdd').onclick=()=>editEntity($('#inventoryKind').value);$('#externalPlanAdd').onclick=()=>editPlan();
 for(const id of ['jobSearch','jobManagement','jobState'])$('#'+id).addEventListener(id==='jobSearch'?'input':'change',filterJobs);
 $('#calendarFilter').onchange=renderCalendar;
 function calendar(mode){calendarMode=mode;$('#calendarWeek').setAttribute('aria-pressed',String(mode==='week'));$('#calendarAgenda').setAttribute('aria-pressed',String(mode==='agenda'));renderCalendar();}
 $('#calendarWeek').onclick=()=>calendar('week');$('#calendarAgenda').onclick=()=>calendar('agenda');
 $('#calendarPrevious').onclick=()=>{calendarOffset--;void load(true);};$('#calendarNext').onclick=()=>{calendarOffset++;void load(true);};$('#calendarToday').onclick=()=>{calendarOffset=0;void load(true);};
 return {sourcesRendered:execution.sources,sourceAliases:execution.sourceAliases,sourceStates:execution.sourceStates,update(data){snapshot=data;renderLivePaths();execution.render();filterJobs();void load();},activity(data){if(!snapshot)return;snapshot={...snapshot,drive:data.drive,folders:snapshot.folders.map(source=>({...source,job:data.jobs[source.id]||source.job}))};renderLivePaths();filterJobs();},async open(page,id,tab){await load(true);if(page==='strategy'){goTab(activeTab);if(id==='plan'&&tab)editPlan(tab);else if(id==='new')editPlan(undefined,tab);else if(id==='entity'&&tab){const [kind,key]=tab.split('~');if(['datasets','targets','sources','locations','software','networks'].includes(kind)){goTab('inventory');$('#inventoryKind').value=kind;renderInventory();editEntity(kind,key);}}else $('#strategyEditor').hidden=true;}else renderCalendar();}};
}
