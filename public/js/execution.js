export function installExecutionViews({n,badge,button,link,date,scheduleText,metric,getStored,getSnapshot,save}){
 const $=selector=>document.querySelector(selector);
 const stateLabel={planned:'Geplant',app:'Durch App umgesetzt',external:'Extern umgesetzt'};
 const planHref=id=>'#strategy/plan/'+id;
 const entityHref=(kind,id)=>'#strategy/entity/'+kind+'~'+id;
 const newId=()=> 'device-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
 const sourceDeviceName=id=>getStored()?.view.catalogSources.find(item=>item.appSourceId===id)?.device||'';
 const targetDeviceName=id=>getStored()?.view.catalogTargets.find(item=>item.appTargetId===id)?.device||'';
 function editor(root,title){root.hidden=false;root.replaceChildren();const heading=n('div',undefined,'panel-title');heading.append(n('h3',title),button('Schließen',()=>{root.hidden=true;}));root.append(heading);root.scrollIntoView({block:'nearest',behavior:'smooth'});return root;}
 function inputField(form,title,name,value,options){const label=n('label',title),input=n(options?'select':'input');input.name=name;input.setAttribute('aria-label',title);if(options)for(const option of options){const node=n('option',option.name);node.value=option.id;input.append(node);}input.value=value??'';label.append(input);form.append(label);return input;}
 function deviceEditor(id){
  const stored=getStored();if(!stored)return;
  const previous=stored.document.data.sources.find(device=>device.id===id),doc=structuredClone(stored.document),revision=stored.revision;
  const root=editor($('#dataDeviceEditor'),previous?'Gerät bearbeiten':'Gerät anlegen'),form=n('form',undefined,'editor-grid');root.append(form);
  inputField(form,'Gerätename','name',previous?.name||'').required=true;
  inputField(form,'Gerätetyp','device_type',previous?.device_type||'nas',[{id:'nas',name:'NAS'},{id:'server',name:'Server / PBS'},{id:'computer',name:'Computer'},{id:'cloud',name:'Cloud-Dienst'},{id:'other',name:'Andere'}]);
  if(previous?.device_type&&!form.elements.device_type.value){const option=n('option',previous.device_type);option.value=previous.device_type;form.elements.device_type.append(option);form.elements.device_type.value=previous.device_type;}
  inputField(form,'Standort','location_id',previous?.location_id||'',[{id:'',name:'Nicht festgelegt'},...stored.document.data.locations]);inputField(form,'Notizen','notes',previous?.notes||'');
  const submit=n('button','Gerät speichern','primary');submit.type='submit';const result=n('p','','hint');result.setAttribute('role','status');form.append(submit,result);
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{const record={...previous,...Object.fromEntries(new FormData(form)),id:previous?.id||newId(),active:1};doc.data.sources=previous?doc.data.sources.map(device=>device.id===id?record:device):[...doc.data.sources,record];await save(doc,doc.mapping,revision);root.hidden=true;}catch(error){result.textContent=error.message;}finally{submit.disabled=false;}};
 }
 function removeDevice(id){
  const stored=getStored(),device=stored.document.data.sources.find(device=>device.id===id),doc=structuredClone(stored.document),revision=stored.revision;
  const root=editor($('#dataDeviceEditor'),'Gerät entfernen'),result=n('p','','hint');root.append(n('p','„'+device.name+'“ entfernen? Verwendete Geräte können erst nach ihren Daten- und Zielzuordnungen entfernt werden. Quelldaten und Sicherungen werden nicht gelöscht.'),button('Entfernen bestätigen',async()=>{try{doc.data.sources=doc.data.sources.filter(device=>device.id!==id);await save(doc,doc.mapping,revision);root.hidden=true;}catch(error){result.textContent=error.message;}},'primary'),result);
 }
 function assignDevice(kind,record){
  const stored=getStored(),doc=structuredClone(stored.document),revision=stored.revision;
  const root=editor($(kind==='source'?'#dataDeviceEditor':'#targetDeviceEditor'),'Gerät zuordnen · '+record.name),form=n('form',undefined,'editor-grid');root.append(form);
  inputField(form,'Gerät','device',record.deviceId||'',[{id:'',name:'Noch nicht zugeordnet / übergeordnetes Gerät übernehmen'},...doc.data.sources]);
  const submit=n('button','Zuordnung speichern','primary');submit.type='submit';const result=n('p','','hint');result.setAttribute('role','status');form.append(submit,result);
  if(!doc.data.sources.length)root.append(link('Zuerst unter Daten ein Gerät anlegen','#sourcesDialog'));
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{const value=form.elements.device.value;if(kind==='source'){doc.mapping.devices??={};if(value)doc.mapping.devices[record.appSourceId]=value;else delete doc.mapping.devices[record.appSourceId];}else if(record.appTargetId){doc.mapping.targetDevices??={};if(value)doc.mapping.targetDevices[record.appTargetId]=value;else delete doc.mapping.targetDevices[record.appTargetId];}else{doc.data.targets=doc.data.targets.map(target=>target.id===record.targetId?{...target,device_id:value||null}:target);}await save(doc,doc.mapping,revision);root.hidden=true;}catch(error){result.textContent=error.message;}finally{submit.disabled=false;}};
 }
 function devices(){
  const stored=getStored();if(!stored)return;const root=$('#dataDevices');root.replaceChildren();$('#deviceCount').textContent=stored.document.data.sources.length;
  for(const device of stored.document.data.sources){const card=n('article',undefined,'device-card'),title=n('strong',device.name),data=stored.view.catalogSources.filter(item=>item.deviceId===device.id).length,targets=stored.view.catalogTargets.filter(item=>item.deviceId===device.id).length;card.append(title,n('small',data+' Datenbestände · '+targets+' Ziele','hint'),button('Bearbeiten',()=>deviceEditor(device.id),'row-action'),button('Entfernen',()=>removeDevice(device.id),'row-action'));root.append(card);}
  if(!root.children.length)root.append(n('p','Noch keine Geräte dokumentiert. Gerät anlegen, danach die Datenbestände und Ziele zuordnen.','hint'));
  const select=$('#dataDeviceFilter'),value=select.value;select.replaceChildren();for(const option of [{id:'all',name:'Alle Geräte'},{id:'unassigned',name:'Nicht zugeordnet'},...stored.document.data.sources.map(device=>({id:device.id,name:device.name}))]){const node=n('option',option.name);node.value=option.id;select.append(node);}select.value=[...select.options].some(option=>option.value===value)?value:'all';
 }
 function groupData(root){
  const stored=getStored();root.querySelectorAll('[data-device-group]').forEach(row=>row.remove());
  const filter=$('#dataDeviceFilter').value,catalog=stored.view.catalogSources;
  const groups=new Map();
  for(const row of [...root.children]){
   const source=catalog.find(item=>row.dataset.sourceId?item.appSourceId===row.dataset.sourceId:item.datasetId===row.dataset.catalogSource);
   const id=source?.deviceId||'unassigned';row.hidden=filter!=='all'&&filter!==id;
   if(row.hidden)continue;
   if(!groups.has(id))groups.set(id,{name:source?.device||'Gerät noch nicht zugeordnet',rows:[]});groups.get(id).rows.push(row);
  }
  if(stored.document.data.sources.length)for(const [id,group]of groups){const row=n('tr');row.dataset.deviceGroup=id;const cell=n('td');cell.colSpan=6;cell.append(n('strong',group.name),n('span',' · '+group.rows.length+' Datenbestände','hint'));if(id!=='unassigned')cell.append(button('Gerät bearbeiten',()=>deviceEditor(id),'row-action'));row.append(cell);root.append(row,...group.rows);}
 }
 function jobDevices(){
  const stored=getStored();if(!stored)return;
  const aliases=id=>[...new Set(stored.view.external.filter(plan=>plan.implementation==='app'&&plan.executionReady&&plan.bindings.includes(id)).map(plan=>plan.name))];
  for(const row of $('#folders').children){const source=getSnapshot().config.sources.find(source=>source.id===row.dataset.folder),title=row.querySelector('.source-link'),names=aliases('pbs:'+row.dataset.folder);if(title){title.textContent=names.length?names.join(' · '):source?.name||row.dataset.folder;title.title=(source?.name||'')+' · Details, Zeitplan und Verlauf öffnen';}row.querySelectorAll('[data-job-device]').forEach(node=>node.remove());for(const [index,name]of [[0,sourceDeviceName(row.dataset.folder)],[1,targetDeviceName(getSnapshot().config.sources.find(source=>source.id===row.dataset.folder)?.target||'primary')]]){if(!name)continue;const note=n('small',name,'path-device');note.dataset.jobDevice='true';row.children[index].prepend(note);}}
  const drive=$('#driveOverview');drive.querySelectorAll('[data-plan-name]').forEach(node=>node.remove());const driveNames=aliases('gdrive');if(driveNames.length){const title=n('strong',driveNames.join(' · '));title.dataset.planName='true';drive.firstElementChild.prepend(title);}
 }
 $('#addDataDevice').onclick=()=>deviceEditor();$('#dataDeviceFilter').onchange=()=>sources();
 function externalRows(){
  const stored=getStored(),root=$('#operatingExternalRows');root.replaceChildren();if(!stored)return;
  for(const job of stored.view.external.filter(job=>job.implementation==='external')){
   const row=n('tr');row.dataset.externalJob=job.planId;
   const source=n('td');source.append(n('small',job.source,'path-device'),n('strong',job.datasetNames.join(', ')));
   const target=n('td');const device=stored.view.catalogTargets.find(target=>target.targetId===job.targetId||target.appTargetId===stored.document.mapping.targets[job.targetId])?.device;if(device)target.append(n('small',device,'path-device'));target.append(n('strong',job.target),n('small',job.protection==='synchronization'?'Synchronisierung':job.protection==='archive'?'Archiv':'Sicherung mit Versionen','hint'));
   const schedule=n('td');schedule.append(n('span',scheduleText(job.schedule)),n('small',job.executor,'hint'));
   const status=n('td');status.append(badge('Extern eingerichtet','external-ready'),n('small','Laufstatus wird nicht abgefragt.','hint'));
   const actions=n('td');actions.append(link('Details bearbeiten',planHref(job.planId)));
   row.append(source,target,schedule,n('td',job.nextAt?date(job.nextAt):'Nur manuell'),n('td','Nicht abgefragt'),status,actions);root.append(row);
  }
 }
 function sources(){
  const stored=getStored(),snapshot=getSnapshot();if(!stored||!snapshot)return;
  const root=$('#sourceList');root.querySelectorAll('[data-catalog-source],[data-device-group]').forEach(row=>row.remove());
  for(const source of stored.view.catalogSources.filter(source=>source.appSourceId)){
   const row=[...root.querySelectorAll('[data-source-id]')].find(row=>row.dataset.sourceId===source.appSourceId);if(!row)continue;
   row.querySelectorAll('[data-source-lifecycle]').forEach(node=>node.remove());
   row.querySelectorAll('[data-device-assignment]').forEach(node=>node.remove());const assign=button('Gerät zuordnen',()=>assignDevice('source',source),'row-action');assign.dataset.deviceAssignment='true';row.lastElementChild.prepend(assign);
   row.querySelectorAll('[data-data-target-device]').forEach(node=>node.remove());
   const configuration=snapshot.config.sources.find(item=>item.id===source.appSourceId);
   const targetNames=configuration?.partitioned?[...new Set(snapshot.config.sources.filter(item=>item.parentId===source.appSourceId).map(item=>(targetDeviceName(item.target||'primary')?targetDeviceName(item.target||'primary')+' / ':'')+(snapshot.targets.find(target=>target.id===(item.target||'primary'))?.name||'Ziel fehlt')))]:[targetDeviceName(configuration?.target||'primary')].filter(Boolean);
   if(targetNames.length){const note=n('small',targetNames.join(', '),'path-device');note.dataset.dataTargetDevice='true';row.children[3].prepend(note);}
   if(source.datasetIds.length){const note=n('small',source.datasetIds.map(id=>stored.document.data.datasets.find(dataset=>dataset.id===id)?.name).filter(Boolean).join(', ')+' · '+source.states.map(state=>stateLabel[state]).join(' / '),'hint');note.dataset.sourceLifecycle='true';row.firstElementChild.append(note);}
  }
  const query=$('#sourceSearch').value.toLocaleLowerCase('de'),filter=$('#sourceStatusFilter').value;
  const metadata=stored.view.catalogSources.filter(source=>!source.appSourceId);
  for(const source of metadata){
   if($('#sourceSearch').dataset.exactId)continue;
   if(query&&![source.name,source.device].join(' ').toLocaleLowerCase('de').includes(query))continue;
   if(['available','unavailable'].includes(filter)||filter==='planned'&&!source.states.includes('planned')||filter==='external'&&!source.states.includes('external'))continue;
   const row=n('tr');row.dataset.catalogSource=source.datasetId;
   const info=n('td');info.append(n('strong',source.name),n('small',source.device||'Datenbestand','hint'),n('small','Kein LXC-Pfad erforderlich, solange die App nicht selbst sichert.','hint'));
   const state=n('td');for(const item of source.states.length?source.states:['planned'])state.append(badge(stateLabel[item],item==='external'?'external-ready':'external'));
   const targets=n('td');targets.textContent=source.plans.map(id=>stored.view.external.find(plan=>plan.planId===id)?.target).filter(Boolean).join(', ')||'Noch kein Ziel';
   const plans=n('td');plans.textContent=source.plans.map(id=>stored.view.external.find(plan=>plan.planId===id)).filter(Boolean).map(plan=>scheduleText(plan.schedule)).join(' / ')||'Noch kein Plan';
   const actions=n('td');actions.append(link('Datenbestand bearbeiten',entityHref('datasets',source.datasetId)));if(source.plans.length)actions.append(link('Sicherungsweg öffnen',planHref(source.plans[0])));else actions.append(link('Umsetzung planen','#strategy/new/'+source.datasetId));
   row.append(info,state,n('td','Nicht gemessen'),targets,plans,actions);root.append(row);
  }
  groupData(root);const total=snapshot.config.sources.length+metadata.length;$('#sourceListCount').textContent=[...root.children].filter(row=>!row.dataset.deviceGroup&&!row.hidden).length+' von '+total+' Datenbeständen';
  if(metadata.length)metric($('#sourceMetrics'),[[total,'Datenbestände insgesamt','App-Ordner und dokumentierte Datenbestände'],[snapshot.config.sources.length,'In der App registriert','Mount-Status je Ordner'],[metadata.filter(source=>source.states.includes('external')).length,'Extern umgesetzt','Ohne Middleware-Mount'],[metadata.filter(source=>!source.states.includes('external')).length,'Noch zu planen','Kein automatischer Laufnachweis']]);
 }
 function targets(){
  const stored=getStored(),root=$('#targetCatalog');root.replaceChildren();$('#targetCatalogPanel').hidden=!stored||(stored.document.data.targets.length===0&&stored.document.data.sources.length===0);if(!stored)return;
  const groups=new Map();for(const target of stored.view.catalogTargets){const id=target.deviceId||'unassigned';if(!groups.has(id))groups.set(id,{name:target.device||'Gerät noch nicht zugeordnet',items:[]});groups.get(id).items.push(target);}
  for(const group of groups.values()){const heading=n('h3',group.name,'target-device-heading');root.append(heading);for(const target of group.items){const row=n('div',undefined,'catalog-target');row.dataset.catalogTarget=target.appTargetId||target.targetId;const info=n('div');info.append(n('strong',target.name));if(target.appTargetId&&target.appTargetId!=='gdrive')info.append(n('small','Datastore','hint'));const states=n('div',undefined,'path-destinations');for(const state of target.states.length?target.states:['planned'])states.append(badge(stateLabel[state],state==='external'?'external-ready':state==='app'?'ok':'external'));row.append(info,states,button('Gerät zuordnen',()=>assignDevice('target',target),'row-action'));
   if(target.targetId)row.append(link('Ziel bearbeiten',entityHref('targets',target.targetId)));else row.append(link('Konfiguration','#targets'));root.append(row);
  }}
 }
 function network(){
  const stored=getStored();if(!stored)return;const simulation=['planned','all'].includes($('#calendarFilter').value),analysis=simulation?stored.view.planningAnalysis:stored.view.analysis,root=$('#networkResults');root.replaceChildren();if(simulation)root.append(n('p','Simulation: eingerichtete Backups und noch geplante Sicherungen werden gemeinsam berücksichtigt.','hint'));
  $('#networkSummary').textContent=analysis.warnings.length+' Hinweise zu Zeitfenstern und Netzlast';
  for(const entry of analysis.networks){const card=n('div',undefined,'network-card');card.append(n('strong',entry.name),n('p',(entry.capacityMiB==null?'Kapazität unbekannt':entry.capacityMiB+' MiB/s Kapazität')+' · '+entry.peakMiB+' MiB/s bekannte erwartete Spitze'+(entry.incomplete?' · unvollständige Angaben':''),'hint'));root.append(card);}
  for(const warning of analysis.warnings){const card=n('div',undefined,'network-warning');card.append(n('strong',warning.network||warning.resource),n('p',warning.jobs.join(' ↔ ')),n('small',date(warning.start)+' – '+date(warning.end)+' · '+warning.message,'hint'));root.append(card);}
  if(analysis.unknownDuration.length)root.append(n('p','Dauer unbekannt: '+analysis.unknownDuration.join(', ')+'. Diese Zeitfenster können nicht vollständig verglichen werden.','hint'));
  if(analysis.unassignedNetworks)root.append(n('p',analysis.unassignedNetworks+' eingerichteten Aufträgen fehlt die Zuordnung zu einem Netzwerkbereich.','hint'));
  if(analysis.limited||stored.view.truncated)root.append(n('p','Sehr viele Termine: Die Auswertung wurde begrenzt und ist unvollständig.','hint'));
  if(!analysis.warnings.length)root.append(n('p','In den bekannten Zeitfenstern wurde keine Konkurrenz erkannt. Unbekannte Dauer oder Bandbreite ist kein Nachweis freier Kapazität.','hint'));
 }
 return {sourceDeviceName,targetDeviceName,render(){devices();externalRows();sources();targets();jobDevices();network();},network,sources,sourceStates(id){return getStored()?.view.catalogSources.find(source=>source.appSourceId===id)?.states||[];},sourceAliases(id){const stored=getStored(),source=stored?.view.catalogSources.find(source=>source.appSourceId===id);return [source?.device,...(source?.datasetIds||[]).map(id=>stored.document.data.datasets.find(dataset=>dataset.id===id)?.name)].filter(Boolean).join(' ');}};
}
