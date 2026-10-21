export function installOperations({api,element,refresh,date}) {
  let snapshot, plan;
  const $=selector=>document.querySelector(selector);
  const bytes=value=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(value/1024**3)+' GiB';
  function renderCapacity() {
    if (!snapshot) return;
    for (const selector of ['#capacityCards','#targetCapacityCards']) {
      const root=$(selector); root.replaceChildren();
      for (const target of [...snapshot.targets, {id:'gdrive',name:'Google Drive'}]) {
        const google=target.id==='gdrive', data=snapshot.capacities?.[target.id]||{}, card=element('article',undefined,'capacity-card'), heading=element('div',undefined,'panel-title');
        card.dataset.capacityTarget=target.id;
        const known=google ? data.checkedAt : data.total, unconfigured=google&&!snapshot.config.gdrive.sources.length&&!known;
        heading.append(element('strong',target.name),element('span',unconfigured?'Noch nicht eingerichtet':data.unsupported?'Keine Kontoquote':data.error?'Abruf fehlgeschlagen':data.warning?'Wenig Platz':known?'Speicherstand':'Noch nicht abgerufen',`badge ${data.error||data.warning?'busy':known&&!data.unsupported?'ok':''}`));card.append(heading);
        if (google && known) {
          card.append(element('p',`${data.available!=null?bytes(data.available)+' frei':'Freier Speicher unbekannt'} · ${data.total!=null?bytes(data.total)+' gesamt':'Gesamtquote nicht gemeldet'}`));
          card.append(element('p',`${data.used!=null?bytes(data.used)+' in Drive':'Drive-Belegung unbekannt'}${data.other!=null?' · '+bytes(data.other)+' andere Google-Dienste':''}${data.trashed!=null?' · '+bytes(data.trashed)+' Papierkorb':''}`,'hint'));
        } else if (!google && data.total) card.append(element('p',`${bytes(data.available)} frei · ${bytes(data.used)} belegt / ${bytes(data.total)} gesamt`));
        if (known) {
          if (data.usedPercent!=null) {const meter=element('progress');meter.max=100;meter.value=data.usedPercent;meter.setAttribute('aria-label',`Belegung ${target.name}`);card.append(meter);}
          card.append(element('small',`${data.usedPercent!=null?data.usedPercent+' % belegt · ':''}Stand ${date(data.checkedAt)}${data.stale?' · veraltet':''}`,'hint'));
        }
        card.append(element('p',data.error||(data.unsupported?'Google meldet für diese Ablage keine Speicherquote (z. B. bei geteilten Ablagen).':unconfigured?'Google Drive unter Backup-Ziele einrichten.':!known?'„Speicher aktualisieren“ wählen.':google?'Kontoweite Quote: freie Kapazität berücksichtigt auch Gmail und Google Fotos. Geteilte Ablagen können keine eigene Quote melden.':'Dateisystem des Datastores · Warnung ab '+snapshot.config.capacityWarnPercent+' % Belegung.'),'hint'));root.append(card);
      }
    }
  }
  async function refreshCapacity() {
    const buttons=[$('#refreshCapacity'),$('#refreshTargetCapacity')], results=[$('#capacityResult'),$('#targetCapacityResult')];
    buttons.forEach(button=>button.disabled=true);results.forEach(field=>field.textContent='Speicherstände werden abgerufen …');
    try {const result=await api('/api/capacity/refresh',{});await refresh();results.forEach(field=>field.textContent=result.deferred?'Abruf wartet auf das Ende laufender oder wartender Aufträge. Letzter Stand wird angezeigt.':'Speicherstände aktualisiert. Fehlgeschlagene Abfragen sind am jeweiligen Ziel markiert.');}
    catch(error){results.forEach(field=>field.textContent=error.message);}finally{buttons.forEach(button=>button.disabled=false);}
  }
  $('#refreshCapacity').addEventListener('click',refreshCapacity);$('#refreshTargetCapacity').addEventListener('click',refreshCapacity);
  async function checkPlan(){const button=$('#checkPlan');button.disabled=true;$('#planningResult').textContent='Zeitpläne werden verglichen …';$('#planningSuggestions').replaceChildren();try{plan=await api('/api/planning');renderPlan();}catch(e){$('#planningResult').textContent=e.message;}finally{button.disabled=false;}}
  function renderPlan(){const root=$('#planningSuggestions');root.replaceChildren();$('#planningResult').textContent=`${plan.suggestions.length} Vorschläge · 10 Minuten Puffer. Wochentage bleiben erhalten.${plan.unknown.length?' Ohne gemessene Dauer: '+plan.unknown.join(', ')+'. Diese Quellen werden nicht eingerechnet.':''}${!plan.suggestions.length&&!plan.unresolved.length?' Keine Überschneidungen zwischen gemessenen Wochenplänen gefunden.':''}${plan.monthly?.length?' Monatliche Pläne ('+plan.monthly.join(', ')+') werden im Gantt berücksichtigt, aber nicht automatisch verschoben.':''}`;
    for(const proposal of plan.suggestions){const row=element('div',undefined,'planning-row'),info=element('div');info.append(element('strong',`${proposal.name}: ${proposal.currentTime} → ${proposal.time}`),element('small','Vermeidet Überschneidung mit '+proposal.conflicts.join(', ')+'.','hint'));const button=element('button','Übernehmen','secondary');button.type='button';button.setAttribute('aria-label',`Zeitvorschlag für ${proposal.name} übernehmen`);button.addEventListener('click',async()=>{root.querySelectorAll('button').forEach(item=>item.disabled=true);try{await api('/api/planning/apply',{id:proposal.id,time:proposal.time,revision:plan.revision});await refresh();await checkPlan();$('#planningResult').textContent=`${proposal.name}: ${proposal.time} gespeichert. `+$('#planningResult').textContent;}catch(e){$('#planningResult').textContent=e.message+' Mit „Zeitplan prüfen“ neu laden.';}});row.append(info,button);root.append(row);}
    for(const issue of plan.unresolved)root.append(element('p',`${issue.name}: ${issue.message}`,'hint'));
  }
  $('#checkPlan').addEventListener('click',checkPlan);
  return {update(data){snapshot=data;renderCapacity();}};
}
