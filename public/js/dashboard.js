import { latestConnection, sourceProblem } from '/js/problems.js';
export function installDashboard({ element, date, openSource, resolveProblem }) {
  const $ = selector => document.querySelector(selector);
  let snapshot;
  function openTarget(id) {
    const panel=$('#'+id);panel.open=true;
    const scroll=()=>panel.scrollIntoView({block:'start'});
    if(location.hash==='#targets') scroll();
    else { window.addEventListener('hashchange',()=>requestAnimationFrame(scroll),{once:true});location.hash='targets'; }
  }
  function render() {
    if (!snapshot) return;
    const folders = snapshot.folders, mounts = $('#dashboardMounts'), targets = $('#dashboardTargets'), issues = $('#dashboardIssues');
    mounts.replaceChildren(); targets.replaceChildren(); issues.replaceChildren();
    const available = folders.filter(source => source.ok).length, checking = folders.filter(source => source.checking).length;
    $('#dashboardMountSummary').textContent = `${available} von ${folders.length} verfügbar${checking ? ' · ' + checking + ' werden geprüft' : ''}`;
    const sorted = [...folders].sort((a,b) => Number(a.ok) - Number(b.ok));
    for (const source of sorted.slice(0,6)) {
      const button = element('button', undefined, 'dashboard-mount'); button.type = 'button'; button.dataset.dashboardSource = source.id;
      const label = source.ok ? 'Eingebunden' : source.checking ? 'Wird geprüft' : 'Nicht verfügbar';
      button.append(element('strong',source.name),element('span',label,'badge '+(source.ok?'ok':source.checking?'busy':'bad')));
      button.title = `${source.path}${source.mount?.source ? ' · '+source.mount.source : ''}${source.checkedAt ? ' · Stand '+date(source.checkedAt) : ''}`;
      button.addEventListener('click',()=>openSource(source)); mounts.append(button);
    }
    $('#dashboardMoreSources').textContent = folders.length > 6 ? `Alle ${folders.length} Quellen ansehen →` : 'Quellen verwalten →';
    let reachable=0, configuredTargets=0;
    function card(name, description, observation, configured, action, override) {
      const age=Date.now()-Date.parse(observation?.checkedAt), recent=Number.isFinite(age)&&age>=-60000&&age<=20*60000;
      if(configured) { configuredTargets++; if(observation?.ok && recent) reachable++; }
      const label = override?.label || (!configured?'Einrichten':observation?.ok===false?'Prüfung fehlgeschlagen':!recent?'Ungeprüft / veraltet':'Erreichbar');
      const tone = override?.tone || (!configured?'busy':observation?.ok===false?'bad':recent?'ok':'');
      const item = element('article',undefined,'dashboard-target'); item.append(element('strong',name),element('span',label,'badge '+tone),element('small',description,'hint'));
      const button=element('button',configured?'Details →':'Einrichten →','row-action');button.type='button';button.addEventListener('click',action);item.append(button);
      item.title = observation?.checkedAt ? 'Letzte Beobachtung: '+date(observation.checkedAt) : 'Noch keine bestätigte Verbindung';targets.append(item);
    }
    for (const target of snapshot.targets) {
      const related=folders.filter(source=>(source.target||'primary')===target.id);
      const latest=related.map(source=>source.job).filter(Boolean).sort((a,b)=>Date.parse(b.lastSuccess||0)-Date.parse(a.lastSuccess||0))[0]||{};
      const active=related.find(source=>['running','queued','cancelling'].includes(source.job?.status));
      const changed=related.map(source=>source.pbsCheckAfter).filter(Boolean).sort().at(-1);
      card('PBS · '+target.name,`${related.length} Quellen · ${target.repository || 'Zugang fehlt'}`,latestConnection(latest,snapshot.connections?.[target.id],snapshot.capacities?.[target.id],changed),Boolean(target.repository&&target.hasPassword),()=>openTarget('pbsSettings'),active?{label:active.job.status==='queued'?'Sicherung wartet':active.job.status==='cancelling'?'Abbruch läuft':'Sicherung läuft',tone:'busy'}:null);
    }
    const drive=snapshot.drive||{}, busy=['queued','running','cancelling'].includes(drive.status);
    card('Google Drive',drive.settings?.sources.length?`${drive.settings.sources.length} Quellen · ${drive.settings.folder}`:'Keine Quellen ausgewählt',latestConnection({lastSuccess:drive.lastSuccess},drive.connection,snapshot.capacities?.gdrive),Boolean(drive.settings?.sources.length),()=>openTarget('driveSettings'),busy?{label:drive.status==='queued'?'Wartet':drive.status==='cancelling'?'Abbruch läuft':'Kopie läuft',tone:'busy'}:drive.status==='failed'?{label:'Kopie fehlgeschlagen',tone:'bad'}:null);
    const problems = folders.map(source=>({source,issue:sourceProblem(source,source.job,source.health,snapshot.targets.find(target=>target.id===(source.target||'primary')),latestConnection(source.job,snapshot.connections?.[source.target||'primary'],snapshot.capacities?.[source.target||'primary'],source.pbsCheckAfter))})).filter(item=>item.issue);
    $('#targetStatus').textContent=`${reachable} / ${configuredTargets} erreichbar`;
    $('#targetName').textContent=configuredTargets?'Zuletzt bestätigte Zielverbindungen':'Noch kein Ziel eingerichtet';
    $('#dashboardIssueCount').textContent = problems.length ? `${problems.length} Hinweise` : 'Keine offenen Hinweise';
    for (const {source,issue} of problems.slice(0,3)) {const button=element('button',`${source.name}: ${issue.message}`,'dashboard-issue');button.type='button';button.addEventListener('click',()=>resolveProblem(source,issue));issues.append(button);}
    $('#dashboardIssues').hidden = !problems.length;
  }
  return { update(data) { snapshot=data;render(); }, activity(data) { if(!snapshot)return;snapshot={...snapshot,drive:data.drive,folders:snapshot.folders.map(source=>({...source,job:data.jobs[source.id]||source.job,health:data.health[source.id]||source.health}))};render(); } };
}
