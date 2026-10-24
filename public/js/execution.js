export function installExecutionViews({n,badge,button,link,date,scheduleText,metric,getStored,getSnapshot}){
 const $=selector=>document.querySelector(selector);
 const stateLabel={planned:'Geplant',app:'Durch App umgesetzt',external:'Extern umgesetzt'};
 const planHref=id=>'#strategy/plan/'+id;
 const entityHref=(kind,id)=>'#strategy/entity/'+kind+'~'+id;
 function externalRows(){
  const stored=getStored(),root=$('#operatingExternalRows');root.replaceChildren();if(!stored)return;
  for(const job of stored.view.external.filter(job=>job.implementation==='external')){
   const row=n('tr');row.dataset.externalJob=job.planId;
   const source=n('td');source.append(n('strong',job.source),n('small',job.datasetNames.join(', '),'hint'));
   const target=n('td');target.append(n('strong',job.target),n('small',job.protection==='synchronization'?'Synchronisierung':job.protection==='archive'?'Archiv':'Sicherung mit Versionen','hint'));
   const schedule=n('td');schedule.append(n('span',scheduleText(job.schedule)),n('small',job.executor,'hint'));
   const status=n('td');status.append(badge('Extern eingerichtet','external-ready'),n('small','Laufstatus wird nicht abgefragt.','hint'));
   const actions=n('td');actions.append(link('Details bearbeiten',planHref(job.planId)));
   row.append(source,target,schedule,n('td',job.nextAt?date(job.nextAt):'Nur manuell'),n('td','Nicht abgefragt'),status,actions);root.append(row);
  }
 }
 function sources(){
  const stored=getStored(),snapshot=getSnapshot();if(!stored||!snapshot)return;
  const root=$('#sourceList');root.querySelectorAll('[data-catalog-source]').forEach(row=>row.remove());
  for(const source of stored.view.catalogSources.filter(source=>source.appSourceId)){
   const row=[...root.querySelectorAll('[data-source-id]')].find(row=>row.dataset.sourceId===source.appSourceId);if(!row)continue;
   row.querySelectorAll('[data-source-lifecycle]').forEach(node=>node.remove());
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
  const total=snapshot.config.sources.length+metadata.length;$('#sourceListCount').textContent=root.children.length+' von '+total+' Quellen';
  if(metadata.length)metric($('#sourceMetrics'),[[total,'Datenquellen insgesamt','App-Ordner und dokumentierte Datenbestände'],[snapshot.config.sources.length,'In der App registriert','Mount-Status je Ordner'],[metadata.filter(source=>source.states.includes('external')).length,'Extern umgesetzt','Ohne Middleware-Mount'],[metadata.filter(source=>!source.states.includes('external')).length,'Noch zu planen','Kein automatischer Laufnachweis']]);
 }
 function targets(){
  const stored=getStored(),root=$('#targetCatalog');root.replaceChildren();$('#targetCatalogPanel').hidden=!stored?.document.data.targets.length;if(!stored)return;
  for(const target of stored.view.catalogTargets){const row=n('div',undefined,'catalog-target'),info=n('div');info.append(n('strong',target.name));const states=n('div',undefined,'path-destinations');for(const state of target.states.length?target.states:['planned'])states.append(badge(stateLabel[state],state==='external'?'external-ready':state==='app'?'ok':'external'));row.append(info,states);
   if(target.targetId)row.append(link('Ziel bearbeiten',entityHref('targets',target.targetId)));else row.append(link('Konfiguration',target.appTargetId==='gdrive'?'#targets':'#targets'));
   root.append(row);
  }
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
 return {render(){externalRows();sources();targets();network();},network,sources,sourceStates(id){return getStored()?.view.catalogSources.find(source=>source.appSourceId===id)?.states||[];},sourceAliases(id){const stored=getStored();return stored?.view.catalogSources.find(source=>source.appSourceId===id)?.datasetIds.map(id=>stored.document.data.datasets.find(dataset=>dataset.id===id)?.name).join(' ')||'';}};
}
