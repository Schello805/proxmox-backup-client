export function installPartitions({api,element,refresh}) {
 const root=document.querySelector('#sourcePartitions');let currentId=null;
 async function open(id){
  currentId=id;root.hidden=false;root.replaceChildren(element('p','Unterordner werden gelesen …','hint'));root.scrollIntoView({block:'start'});
  try{
   const data=await api('/api/partitions/'+id);if(currentId!==id)return;
   root.replaceChildren();const heading=element('div',undefined,'panel-title'),close=element('button','Schließen','secondary');close.type='button';close.onclick=()=>{currentId=null;root.hidden=true;};heading.append(element('h3','Unterordner zuordnen · '+data.source.name),close);root.append(heading);
   root.append(element('p','Je Unterordner ein PBS-Auftrag. Dateien bleiben unverändert auf der QNAP. Nach dem Speichern wird die Hauptquelle nicht mehr zusätzlich als Ganzes auf PBS gesichert. Bestehende PBS-Snapshots bleiben erhalten.','hint'));
   root.append(element('p','Neue Unterordner später hier zuordnen. Größen der Teilquellen werden nach dem Speichern ermittelt. Ein Datastore ist keine eigene Festplatte; den tatsächlichen freien Speicher unter Ziele prüfen.','hint'));
   const tools=element('div',undefined,'actions'),select=element('select');select.setAttribute('aria-label','Ziel für alle Unterordner');
   for(const target of data.targets.filter(item=>item.repository&&item.hasPassword)){const option=new Option(target.name,target.id);select.append(option);}
   const all=element('button','Allen zuweisen','secondary');all.type='button';tools.append(select,all);root.append(tools);
   const table=element('table'),head=element('thead'),header=element('tr');header.append(element('th','Unterordner'),element('th','Größe'),element('th','PBS-Ziel'));head.append(header);table.append(head);const body=element('tbody'),fields=[];
   for(const folder of data.folders){const row=element('tr'),field=element('select');field.setAttribute('aria-label','Ziel für '+folder.name);field.append(new Option('Bitte zuordnen',''));for(const target of data.targets.filter(item=>item.repository&&item.hasPassword))field.append(new Option(target.name,target.id));field.value=folder.target;const cell=element('td');cell.append(field);row.append(element('td',folder.name),element('td',folder.bytes==null?'Noch nicht gemessen':new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(folder.bytes/1024**3)+' GiB'),cell);body.append(row);fields.push({folder:folder.name,field,bytes:folder.bytes});}
   table.append(body);const wrap=element('div',undefined,'table-wrap partition-table');wrap.append(table);root.append(wrap);const summary=element('p','','hint');summary.setAttribute('aria-live','polite');root.append(summary);const allocation=()=>{summary.textContent=data.targets.map(target=>{const assigned=fields.filter(item=>item.field.value===target.id);if(!assigned.length)return null;const known=assigned.filter(item=>item.bytes!=null);return target.name+': '+assigned.length+' Ordner'+(known.length?' · '+(known.length<assigned.length?'mind. ':'')+new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(known.reduce((sum,item)=>sum+item.bytes,0)/1024**3)+' GiB':' · Größe noch nicht gemessen');}).filter(Boolean).join(' | ');};for(const item of fields)item.field.onchange=allocation;all.onclick=()=>{for(const item of fields)item.field.value=select.value;allocation();};allocation();
   const confirmation=element('label','Ich bestätige die Aufteilung. Jeder Unterordner wird separat gesichert; neue Teilaufträge übernehmen den bisherigen PBS-Zeitplan.','checkbox-label'),check=element('input');check.type='checkbox';confirmation.prepend(check);root.append(confirmation);
   const result=element('p','', 'hint');result.setAttribute('role','status');
   const save=element('button','Zuordnung speichern','primary');save.type='button';save.disabled=data.otherEntries>0||!fields.length;
   if(data.otherEntries)root.append(element('p',`${data.otherEntries} Dateien oder Verknüpfungen liegen direkt im Hauptverzeichnis. Vor einer Aufteilung in Unterordner einordnen. Bis dahin bleibt die bisherige Konfiguration erhalten.`,'row-error'));
   save.onclick=async()=>{if(!check.checked){result.textContent='Bitte die Aufteilung bestätigen.';return;}if(fields.some(item=>!item.field.value)){result.textContent='Jedem Unterordner ein Ziel zuweisen.';return;}save.disabled=true;try{const reply=await api('/api/partitions/'+id,{confirmed:true,mapping:fields.map(item=>({folder:item.folder,target:item.field.value}))});await refresh();result.textContent=`Gespeichert: ${reply.created} Unterordner-Aufträge. Unter Aufträge starten oder Zeitpläne bearbeiten.`;}catch(error){result.textContent=error.message;}finally{save.disabled=false;}};
   const actions=element('div',undefined,'actions');actions.append(save);
   if(data.source.partitioned){const restore=element('button','Wieder als ganze Quelle sichern','secondary');restore.type='button';restore.onclick=async()=>{if(!check.checked){result.textContent='Bitte die Änderung bestätigen.';return;}restore.disabled=true;try{await api('/api/partitions/'+id+'/restore',{confirmed:true});await refresh();await open(id);}catch(error){result.textContent=error.message;restore.disabled=false;}};actions.append(restore);}
   root.append(actions,result);
  }catch(error){root.replaceChildren(element('p',error.message,'row-error'));}
 }
 return {open};
}
