import { installMaintenance } from '/js/maintenance.js';
import { createAPI } from '/js/api.js';
import { createViews, dayNames } from '/js/views.js';
import { createFormState, clearFieldErrors, showFieldErrors, serverField, validateMainForm, validateNotifyForm, validateSourceForm } from '/js/forms.js';
'use strict';
const refreshWaiters = [];
const $ = selector => document.querySelector(selector);
const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik', daten: 'Daten' };
const statuses = { idle: 'Noch kein Lauf', queued: 'Wartet', running: 'Läuft', success: 'Erfolgreich', failed: 'Fehler', interrupted: 'Unterbrochen' };
let loaded = false, polling = false, logFolder = null, noticeTimer, authenticated = false, activityPolling = false, previousActive = null, authEpoch = 0, activeTimezone = 'Europe/Berlin', savedConfig = null, folderData = [], lastHealth = {}, logRun = null, sourceEditing = null, pbsData = null, sourcePage = 0, lastMainSnapshot = null, lastNotifySnapshot = null, mountDiscovery = { candidates: [] };
const api = createAPI(showLogin);
const { element, date, nextText, renderJob, scheduleText, renderEstimate } = createViews(() => activeTimezone, statuses);
const formState = createFormState(['configForm', 'authForm', 'notifyForm'].map(id => document.getElementById(id)));
function notice(message, error = false) {
  $('#notice').textContent = message; $('#notice').classList.toggle('error', error); $('#notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('#notice').hidden = true, 12000);
}
const presets = { manual: [], daily: [1,2,3,4,5,6,7], weekdays: [1,2,3,4,5], weekend: [6,7] };
const scheduleControls = new Map();
function buildSchedule(id, name, schedule) {
  const row = element('div', undefined, 'schedule-row'); row.dataset.schedule = id; const title = element('strong', name);
  const mode = element('select'); mode.name = `frequency-${id}`; mode.setAttribute('aria-label', `Häufigkeit ${name}`);
  for (const [value, text] of [['manual','Nur manuell'],['daily','Täglich'],['weekdays','Werktags (Mo–Fr)'],['weekend','Wochenende'],['weekly','Wöchentlich'],['custom','Eigene Tage']]) { const option = element('option', text); option.value = value; mode.append(option); }
  const time = element('input'); time.type = 'time'; time.name = `schedule-${id}`; time.setAttribute('aria-label', `Uhrzeit ${name}`); time.value = schedule.time;
  const days = element('div', undefined, 'week-days'); days.setAttribute('role', 'group'); days.setAttribute('aria-label', `Wochentage ${name}`);
  const hint = element('span', undefined, 'schedule-days-hint');
  const current = [...schedule.days];
  const matched = Object.entries(presets).find(([, values]) => values.join(',') === current.join(','));
  mode.value = matched ? matched[0] : current.length === 1 ? 'weekly' : 'custom';
  const control = { mode, time, days: current }; scheduleControls.set(id, control);
  for (let day = 1; day <= 7; day++) {
    const button = element('button', dayNames[day - 1]); button.type = 'button'; button.dataset.day = day;
    button.setAttribute('aria-label', `${name}: ${['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'][day - 1]}`);
    button.addEventListener('click', () => {
      formState.touch('configForm');
      if (control.days.includes(day)) { if (control.days.length === 1) return; control.days = control.days.filter(value => value !== day); }
      else control.days = [...control.days, day].sort((a,b) => a-b);
      mode.value = control.days.length === 1 ? 'weekly' : 'custom'; paint();
    }); days.append(button);
  }
  function paint() {
    const manual = mode.value === 'manual', custom = ['weekly','custom'].includes(mode.value);
    time.disabled = manual; time.required = !manual; days.hidden = !custom; hint.hidden = custom;
    hint.textContent = manual ? 'Automatik aus' : control.days.map(day => dayNames[day - 1]).join(' · ');
    for (const button of days.children) button.setAttribute('aria-pressed', String(control.days.includes(Number(button.dataset.day))));
  }
  mode.addEventListener('change', () => {
    if (presets[mode.value]) control.days = [...presets[mode.value]];
    else if (mode.value === 'weekly') control.days = [control.days[0] || 7];
    else if (!control.days.length) control.days = [1,3,5];
    paint();
  });
  row.append(title, mode, time, days, hint); $('#schedules').append(row); paint();
}
function fillForm(config) {
  const mainSnapshot = JSON.stringify([config.repository, config.secondaryDatastore, config.fingerprint, config.namespace, config.timezone, config.staleAfterDays, config.sources, config.schedules, config.hasPassword]);
  if (!formState.dirty('configForm') && mainSnapshot !== lastMainSnapshot) {
  lastMainSnapshot = mainSnapshot;
  const form = $('#configForm');
  const at = config.repository.lastIndexOf('@'), colon = config.repository.lastIndexOf(':');
  form.elements.authId.value = at > 0 ? config.repository.slice(0, at) : '';
  form.elements.server.value = at > 0 && colon > at ? config.repository.slice(at + 1, colon) : '';
  form.elements.datastore.value = colon > at ? config.repository.slice(colon + 1) : 'pbs1';
  form.elements.secondaryDatastore.value = config.secondaryDatastore || '';
  for (const key of ['fingerprint', 'namespace']) form.elements[key].value = config[key];
  $('#repositoryPreview').textContent = config.repository || 'Noch nicht gespeichert';
  form.elements.password.value = '';
  if (![...form.elements.timezone.options].some(option => option.value === config.timezone)) {
    const option = element('option');
    option.value = option.textContent = config.timezone;
    form.elements.timezone.append(option);
  }
  form.elements.timezone.value = config.timezone;
  form.elements.staleAfterDays.value = config.staleAfterDays;
  $('#passwordHint').textContent = config.hasPassword ? 'PBS-Passwort gespeichert · leer lassen zum Beibehalten.' : 'PBS-Passwort noch nicht hinterlegt.';
    $('#schedules').replaceChildren(); scheduleControls.clear();
  }
  if (!formState.dirty('authForm')) { $('#authForm').elements.authEnabled.checked = config.authEnabled; $('#authResult').textContent = config.authEnabled ? 'Passwortschutz ist eingeschaltet.' : 'Zugriff im Netzwerk ohne App-Passwort.'; }
  $('#logout').hidden = !config.authEnabled;
  const notifySnapshot = JSON.stringify(config.notifications);
  if (!formState.dirty('notifyForm') && notifySnapshot !== lastNotifySnapshot) { fillNotifications(config.notifications); lastNotifySnapshot = notifySnapshot; }
  for (const [id, control] of scheduleControls) if (!names[id]) { document.querySelector(`[data-schedule="${id}"]`)?.remove(); scheduleControls.delete(id); }
  for (const [id, name] of Object.entries(names)) if (!scheduleControls.has(id)) buildSchedule(id, name, config.schedules[id]);
}
async function refresh() {
  if (polling) return new Promise(resolve => refreshWaiters.push(resolve)); polling = true; const epoch = authEpoch;
  try {
    const data = await api('/api/status');
    if (epoch !== authEpoch) return;
    mountDiscovery = data.discovery || { candidates: [] };
    $('#showDiscovered').hidden = !mountDiscovery.candidates.length;
    $('#showDiscovered').textContent = `Neue SMB-Freigaben (${mountDiscovery.candidates.length})`;
    savedConfig = data.config; activeTimezone = data.config.timezone; folderData = data.folders;
    for (const key of Object.keys(names)) delete names[key]; for (const source of data.config.sources) names[source.id] = source.name;
    $('#appVersion').textContent = `v${data.system.version}`;
    $('#systemChecks').replaceChildren(...data.system.checks.map(check => element('li', `${check.ok ? '✓' : '⚠'} ${check.name}: ${check.message}`, check.ok ? 'check-ok' : 'check-warning')));
    $('#sidebarTimezone').textContent = activeTimezone; $('#sourceCount').textContent = data.folders.length;
    authenticated = true; document.body.classList.remove('locked'); if ($('#loginDialog').open) $('#loginDialog').close();
    $('#updated').textContent = `Aktualisiert ${new Date().toLocaleTimeString('de-DE', { timeZone: activeTimezone })} · live`;
    $('#mountCount').textContent = `${data.folders.filter(f => f.ok).length} / ${data.folders.length}`;
    $('#runningCount').textContent = data.folders.filter(f => ['running', 'queued'].includes(f.job.status)).length;
    $('#successCount').textContent = `${data.folders.filter(f => f.job.status === 'success').length} / ${data.folders.length}`;
    $('#targetStatus').textContent = data.connection ? (data.connection.ok ? 'Verbunden' : 'Prüfung fehlgeschlagen') : 'Ungeprüft';
    $('#targetName').textContent = data.targets?.map(target => target.name).join(' · ') || data.config.repository || 'Noch kein Repository';
    $('#targetName').title = (data.targets || []).map(target => target.repository).join(' · ');
    const checks = Object.values(data.connections || {}).filter(Boolean);
    if (data.targets?.length > 1) $('#targetStatus').textContent = checks.length ? `${checks.filter(check => check.ok).length} / ${data.targets.length} geprüft OK` : 'Ungeprüft'; $('#flowTarget').textContent = data.config.repository || 'Ziel noch nicht konfiguriert';
    $('#folders').replaceChildren();
    sourcePage = Math.max(0, Math.min(sourcePage, Math.ceil(data.folders.length / 6) - 1));
    $('#overviewPager').hidden = data.folders.length <= 6; $('#sourcePage').textContent = `Seite ${sourcePage + 1} / ${Math.ceil(data.folders.length / 6)}`;
    $('#previousSources').disabled = sourcePage === 0; $('#nextSources').disabled = (sourcePage + 1) * 6 >= data.folders.length;
    for (const folder of data.folders.slice(sourcePage * 6, (sourcePage + 1) * 6)) {
      const row = element('tr'); row.dataset.folder = folder.id; const source = element('td'); const sourceButton = element('button', names[folder.id], 'source-link'); sourceButton.title = 'Details, Zeitplan und Verlauf öffnen'; sourceButton.addEventListener('click', () => openHistory(folder.id)); const path = element('code', folder.path); path.title = folder.path; const target = element('small', folder.targetRepository?.split(':').at(-1) || 'Ziel fehlt', 'source-target'); target.title = folder.targetRepository || 'PBS-Ziel noch nicht konfiguriert'; const heading = element('div', undefined, 'source-heading'); heading.append(sourceButton, target); source.append(heading, path); row.append(source);
      const mount = element('td'), badge = element('span', folder.ok ? '● Eingebunden' : folder.mount?.source && folder.expectedSource && folder.mount.source !== folder.expectedSource ? '● SMB geändert' : '● Nicht verfügbar', `badge ${folder.ok ? 'ok' : 'bad'}`); badge.title = folder.ok ? `${folder.mount.source} → ${folder.mount.target} (${folder.mount.type}) · ${folder.identityConfirmed ? 'SMB-Identität bestätigt' : 'SMB-Quelle noch nicht festgelegt: unter Quellen bestätigen'}` : `${folder.error}${folder.mount?.source ? ' Erkannt: ' + folder.mount.source : ''}`; mount.append(badge);
      const size = folder.size;
      const sizeLabel = size?.bytes != null ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(size.bytes / 1024 ** 3) + ' GiB' : ({ scanning: 'Größe wird ermittelt …', pending: 'Größe vorgemerkt …', error: 'Größe nicht verfügbar' }[size?.status] || (folder.mount?.source && !folder.ok ? 'Erkannt: ' + folder.mount.source : 'Größe: —'));
      const sizeInfo = element('small', sizeLabel, 'source-size');
      sizeInfo.title = size?.error || `Dateigröße der Quelle (unkomprimiert)${size?.checkedAt ? ' · Stand: ' + date(size.checkedAt) : ''} · Automatisch alle 6 Stunden oder über „Aktualisieren“. Große Freigaben können länger dauern.`;
      mount.append(sizeInfo); row.append(mount);
      const plan = element('td'); plan.append(element('span', scheduleText(folder.schedule)), element('small', nextText(folder.health), 'next-run')); plan.classList.add('plan-link'); plan.tabIndex = 0; plan.setAttribute('role', 'button'); plan.setAttribute('aria-label', `Zeitplan ${names[folder.id]} bearbeiten`); plan.addEventListener('click', () => editSource(folder.id, true)); plan.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editSource(folder.id, true); } }); plan.title = `${scheduleText(folder.schedule)} · ${nextText(folder.health)} (${activeTimezone})`;
      row.append(plan, element('td', date(folder.job.lastSuccess)));
      const state = element('td'); state.className = 'job-state'; renderJob(state, folder.job, folder.health); row.append(state); const status = folder.job.status;
      const actions = element('td'), start = element('button', '↗ Sichern', 'row-action'), logs = element('button', 'Protokoll', 'row-action');
      start.dataset.start = folder.id; start.dataset.available = String(Boolean(folder.ok && folder.targetRepository && data.config.hasPassword));
      start.disabled = !folder.ok || !folder.targetRepository || !data.config.hasPassword || ['running', 'queued'].includes(status);
      start.addEventListener('click', async () => { start.disabled = true; try { await api(`/api/backup/${folder.id}`, {}); notice(`${names[folder.id]} zur Sicherung vorgemerkt.`); await refresh(); } catch (e) { notice(e.message, true); start.disabled = false; } });
      logs.addEventListener('click', () => openLog(folder.id)); actions.append(start, logs); row.append(actions); $('#folders').append(row);
    }
    $('#systemInfo').replaceChildren();
    for (const [label, value] of [['Host', data.system.hostname], ['System', data.system.platform], ['Backup Client', data.system.client], ['Zeitpläne', data.system.timezone]]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#systemInfo').append(item); }
    fillForm(data.config); loaded = true;
    const connectionMessages = (data.targets || []).filter(target => data.connections?.[target.id]).map(target => `${target.name}: ${data.connections[target.id].message} (${date(data.connections[target.id].checkedAt)})`);
    $('#connectionResult').textContent = connectionMessages.join(' · ');
    await refreshActivity();
  } catch (e) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; if (authenticated) notice(e.message, true); } finally { polling = false; if (refreshWaiters.length) { const waiters = refreshWaiters.splice(0); await refresh(); for (const resolve of waiters) resolve(); } }
}
async function refreshLog() { try { const data = await api(logRun ? `/api/history/${logFolder}/${logRun}` : `/api/logs/${logFolder}`); const pre = $('#logText'), bottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40; pre.textContent = data.log; if (bottom) pre.scrollTop = pre.scrollHeight; } catch (e) { notice(e.message, true); } }
async function openLog(id, runId = null) { logFolder = id; logRun = runId; $('#logTitle').textContent = `Protokoll · ${names[id]}`; $('#logText').textContent = 'Wird geladen …'; showContext('logDialog', id); await refreshLog(); }
$('#liveDetails').addEventListener('click', () => { if (previousActive) openLog(previousActive); });
$('#closeLog').addEventListener('click', closeContext);
let detailId = null;
const homes = new Map(['sourceForm','historyDialog','logDialog'].map(id => [id, { parent: $('#' + id).parentNode, next: $('#' + id).nextSibling }]));
function restoreContext() {
  for (const [id, home] of homes) home.parent.insertBefore($('#' + id), home.next?.parentNode === home.parent ? home.next : null);
  $('#sourceDetail').hidden = true; $('#historyDialog').hidden = true; $('#logDialog').hidden = true;
  logFolder = null; logRun = null; detailId = null;
}
function closeContext() { location.hash = '#overview'; }
function showContext(view, id) {
  const route = `overview/${id}/${view === 'logDialog' ? 'log' : view === 'historyDialog' ? 'history' : 'edit'}`;
  if (location.hash.slice(1) !== route) history.pushState(null, '', '#' + route);
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== 'overview');
  $('#sourceDetail').hidden = false; detailId = id; $('#detailTitle').textContent = names[id] || id;
  const slots = { sourceForm: 'detailEditor', historyDialog: 'detailHistorySlot', logDialog: 'detailLogSlot' };
  for (const [key, slot] of Object.entries(slots)) { $('#' + slot).hidden = key !== view; if (key === view) { $('#' + slot).append($('#' + key)); $('#' + key).hidden = false; } }
  if (view !== 'logDialog') { logFolder = null; logRun = null; }
  document.querySelectorAll('.detail-tabs button').forEach(button => button.classList.toggle('active', button.id === ({ sourceForm: 'detailEdit', historyDialog: 'detailHistory', logDialog: 'detailLog' })[view]));
  $('#sourceDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function navigate() {
  restoreContext();
  const [requested, id, tab] = location.hash.slice(1).split('/');
  const page = ['overview','settings','guide','sourcesDialog','pbsDialog','systemDialog'].includes(requested) ? requested : 'overview';
  document.body.dataset.page = page;
  if (!id) window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page);
  document.querySelectorAll('[data-page]').forEach(el => { const active = el.dataset.page === page; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  if (!savedConfig) return;
  if (page === 'sourcesDialog') renderSources();
  if (page === 'pbsDialog') openPBS();
  if (page === 'systemDialog') document.dispatchEvent(new Event('open-system'));
  if (page === 'overview' && names[id]) { if (tab === 'log') void openLog(id); else if (tab === 'history') void openHistory(id); else editSource(id, true); }
}
window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate);
$('#closeDetail').addEventListener('click', closeContext);
$('#detailEdit').addEventListener('click', () => editSource(detailId, true));
$('#detailHistory').addEventListener('click', () => openHistory(detailId));
$('#detailLog').addEventListener('click', () => openLog(detailId));
$('#appVersion').addEventListener('click', () => { location.hash = 'systemDialog'; });
navigate();
$('#refresh').addEventListener('click', async () => {
  const button = $('#refresh'); button.disabled = true; button.textContent = '↻ Prüfe Mounts …';
  try {
    const result = await api('/api/refresh', {});
    await refresh();
    setTimeout(() => { if (authenticated) void refresh(); }, 1500);
    notice(result.discovery.error || (result.sizeDeferred ? 'Mounts neu geprüft. Größenmessungen warten auf das Ende laufender Sicherungen bzw. der Wartung.' : 'Mounts neu geprüft. Größen werden im Hintergrund neu ermittelt.') + (result.discovery.candidates.length ? ` ${result.discovery.candidates.length} neue SMB-Freigabe(n) erkannt.` : ''), Boolean(result.discovery.error));
  } catch (e) { notice(e.message, true); }
  finally { button.disabled = false; button.textContent = '↻ Aktualisieren'; }
});
$('#previousSources').addEventListener('click', () => { sourcePage = Math.max(0, sourcePage - 1); void refresh(); });
$('#nextSources').addEventListener('click', () => { sourcePage++; void refresh(); });
$('#configForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!loaded) return notice('Konfiguration zuerst laden.', true);
  const form = event.currentTarget, button = form.querySelector('[type=submit]'), data = { schedules: {} };
  const target = Object.fromEntries(['server','authId','datastore'].map(key => [key, form.elements[key].value.trim()]));
  data.repository = target.server || target.authId || form.elements.password.value ? `${target.authId}@${target.server}:${target.datastore}` : '';
  for (const key of ['password', 'fingerprint', 'namespace', 'timezone', 'secondaryDatastore']) data[key] = form.elements[key].value;
  data.staleAfterDays = Number(form.elements.staleAfterDays.value);
  data.sources = savedConfig.sources;
  for (const id of Object.keys(names)) { const control = scheduleControls.get(id); data.schedules[id] = { days: control.mode.value === 'manual' ? [] : control.days, time: control.mode.value === 'manual' ? '' : control.time.value }; }
  const errors = validateMainForm({ ...target, ...data }); showFieldErrors(form, errors);
  if (Object.keys(errors).length) { $('#settingsResult').textContent = 'Bitte die markierten Felder korrigieren.'; return; }
  const stamp = formState.capture('configForm');
  button.disabled = true; $('#settingsResult').textContent = '';
  try { await api('/api/config', data); const clean = formState.clean('configForm', stamp); if (clean) lastMainSnapshot = null; loaded = false; await refresh(); $('#settingsResult').textContent = clean ? 'Gespeichert. Die Verbindung kannst du separat prüfen.' : 'Gespeichert. Neuere Eingaben sind noch ungespeichert.'; } catch (e) { const field = serverField(e); if (field) showFieldErrors(form, { [field]: e.message }); $('#settingsResult').textContent = e.message; notice(e.message, true); } finally { button.disabled = false; }
});
$('#testConnection').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#connectionResult').textContent = 'Verbindung wird geprüft …';
  try { const results = []; for (const target of backupTargets()) { const data = await api('/api/connection', { target: target.id }); results.push(`${target.name}: ${data.message}`); } await refresh(); $('#connectionResult').textContent = results.join(' · '); } catch (e) { notice(e.message, true); } finally { button.disabled = false; }
});
function showLogin() {
  authEpoch++; authenticated = false; loaded = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) if (dialog.id !== 'loginDialog') dialog.close();
  document.body.classList.add('locked');
  if (!$('#loginDialog').open) { $('#loginPassword').value = ''; $('#loginError').textContent = ''; $('#loginDialog').showModal(); }
}
$('#loginDialog').addEventListener('cancel', event => event.preventDefault());
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try { await api('/api/login', { password: $('#loginPassword').value }); authenticated = true; $('#loginPassword').value = ''; $('#loginDialog').close(); document.body.classList.remove('locked'); await refresh(); navigate(); }
  catch (e) { $('#loginError').textContent = e.message; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', {}); showLogin(); } catch (e) { notice(e.message, true); } });
function duration(start) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(start)) / 1000));
  return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min ${seconds % 60} s`;
}
async function refreshActivity() {
  if (!authenticated || activityPolling) return;
  activityPolling = true; const epoch = authEpoch;
  try {
    const data = await api('/api/activity');
    if (epoch !== authEpoch) return;
    $('#activityMeta').replaceChildren();
    $('#activityBadge').textContent = data.active ? '● Läuft' : '● Bereit';
    $('#activityBadge').className = `badge ${data.active ? 'busy' : 'ok'}`;
    $('.activity').classList.toggle('running', Boolean(data.active));
    $('#runningCount').textContent = (data.active ? 1 : 0) + data.queue.length;
    let estimateJob = data.active ? data.jobs[data.active] : null;
    if (data.active) {
      const job = data.jobs[data.active];
      $('#activityTitle').textContent = `${names[data.active]} · ${job.repository?.split(':').at(-1) || 'Ziel wird geprüft'} · ${data.phase === 'checking' ? 'Quelle wird geprüft' : 'Backup läuft'}`;
      $('#activityDescription').textContent = job.progress ? `Messwert: ${date(job.progress.updatedAt)} · Upload zählt die vom Client gemeldeten Daten; Komprimierung und Deduplizierung beeinflussen den Netzverkehr.` : 'Warte auf Messwerte des Clients. Ältere Clients liefern eventuell erst am Ende Werte; das Live-Protokoll bleibt verfügbar.';
      for (const [label, value] of [['Laufzeit', duration(job.startedAt)], ['Verarbeitet', formatBytes(job.progress?.processedBytes)], ['Upload (Client)', formatBytes(job.progress?.uploadedBytes)], ['Ø Verarbeitung', job.progress?.processingBytesPerSecond != null ? formatBytes(job.progress.processingBytesPerSecond) + '/s' : '—']]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#activityMeta').append(item); }
      $('#liveDetails').hidden = false;

    } else {
      $('#activityTitle').textContent = 'Gerade läuft kein Backup';
      const latest = Object.entries(data.jobs).filter(([, job]) => job.endedAt).sort((a, b) => b[1].endedAt.localeCompare(a[1].endedAt))[0];
      if (latest?.[1].status === 'success') estimateJob = latest[1];
      if (latest && ['failed', 'interrupted'].includes(latest[1].status)) { $('#activityBadge').textContent = 'Letzter Lauf mit Fehler'; $('#activityBadge').className = 'badge bad'; }
      $('#activityDescription').textContent = latest ? `Letzter Lauf: ${names[latest[0]]} · ${statuses[latest[1].status]} · ${date(latest[1].endedAt)}${latest[1].error ? ' · ' + latest[1].error : ''}` : 'Starte unten eine Sicherung oder hinterlege einen Wochenplan in den Einstellungen.';
      $('#liveDetails').hidden = true;
    }
    $('#activityTitle').title = $('#activityTitle').textContent;
    $('#activityDescription').title = $('#activityDescription').textContent;
    previousActive = data.active;
    renderEstimate($('#queueInfo'), estimateJob, data.queue.length ? `Danach: ${data.queue.map(id => names[id]).join(' → ')}` : estimateJob ? '' : 'Keine weiteren Aufträge in der Warteschlange.');
    lastHealth = data.health || {};
    for (const row of document.querySelectorAll('[data-folder]')) {
      const job = data.jobs[row.dataset.folder] || { status: 'idle' }, state = row.querySelector('.job-state');
      renderJob(state, job, lastHealth[row.dataset.folder]);
      const next = row.querySelector('.next-run'); if (next) next.textContent = nextText(lastHealth[row.dataset.folder]);
      row.children[3].textContent = date(job.lastSuccess);
      const start = row.querySelector('[data-start]'); start.disabled = start.dataset.available !== 'true' || ['running', 'queued'].includes(job.status);
    }
    $('#successCount').textContent = `${Object.values(data.jobs).filter(job => job.status === 'success').length} / ${Object.keys(names).length}`;
    if (!data.active) {
      const warnings = Object.values(lastHealth).filter(item => item.missed || item.stale).length;
      if (warnings) { $('#activityBadge').textContent = `${warnings} Hinweis${warnings > 1 ? 'e' : ''}`; $('#activityBadge').className = 'badge busy'; }
    }
    if (data.maintenance && !data.active) { $('#activityTitle').textContent = 'Wartung / Update'; $('#activityBadge').textContent = 'Pausiert'; $('#activityBadge').className = 'badge busy'; $('#activityDescription').textContent = 'Neue Backups sind während des Updates gesperrt.'; }
    if (data.notification && !$('#notifyDetails').open) $('#notificationResult').textContent = `${data.notification.message} (${date(data.notification.at)})`;
    if (logFolder) await refreshLog();
  } catch (e) { if (authenticated) { $('#activityBadge').textContent = 'Verbindung unterbrochen'; $('#activityBadge').className = 'badge bad'; notice(e.message, true); } }
  finally { activityPolling = false; }
}
const timezones = new Set(['Europe/Berlin', 'UTC', ...((Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) || ['Europe/London','America/New_York'])]);
$('#timezones').replaceChildren();
for (const zone of timezones) { const option = element('option'); option.value = option.textContent = zone; $('#timezones').append(option); }
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeContext));

function resetSource() {
  sourceEditing = null; clearFieldErrors($('#sourceForm')); $('#sourceForm').reset(); $('#sourceForm').elements.id.readOnly = false; $('#sourceFormTitle').textContent = 'Quelle hinzufügen'; $('#sourceResult').textContent = ''; fillSourcePlan({ days: [], time: '' });
}
function backupTargets() {
  return [{ id: 'primary', name: savedConfig?.repository?.split(':').at(-1) || 'Datastore 1' }, ...(savedConfig?.secondaryDatastore ? [{ id: 'secondary', name: savedConfig.secondaryDatastore }] : [])];
}
function renderSources() {
  const selected = $('#sourceForm').elements.target.value || 'primary';
  $('#sourceForm').elements.target.replaceChildren(...backupTargets().map(target => { const option = element('option', target.name); option.value = target.id; return option; }));
  $('#sourceForm').elements.target.value = selected;
  renderDiscovered();
  $('#sourceList').replaceChildren();
  for (const source of savedConfig.sources) {
    const row = element('div', undefined, 'source-editor-row'), info = element('div');
    info.append(element('strong', source.name), element('code', source.path), element('small', source.expectedSource || 'SMB-Identität noch nicht festgelegt', 'hint'));
    info.append(element('small', 'Ziel: ' + (backupTargets().find(target => target.id === (source.target || 'primary'))?.name || 'Nicht konfiguriert'), 'hint'));
    const detected = folderData.find(item => item.id === source.id)?.mount?.source; if (detected) info.append(element('small', `Aktuell erkannt: ${detected}`, 'hint'));
    const actions = element('div', undefined, 'source-editor-actions');
    const edit = element('button', 'Bearbeiten', 'row-action'); edit.addEventListener('click', () => {
      editSource(source.id);
    });
    const pin = element('button', 'SMB bestätigen', 'row-action'); pin.addEventListener('click', async () => {
      pin.disabled = true;
      try { const check = await api('/api/sources/probe', { path: source.path }); if (!check.ok) throw new Error(check.error); await api('/api/sources', { sources: savedConfig.sources.map(item => item.id === source.id ? { ...item, expectedSource: check.mount.source } : item) }); loaded = false; await refresh(); renderSources(); $('#sourceResult').textContent = `Bestätigt: ${check.mount.source}`; }
      catch (e) { $('#sourceResult').textContent = e.message; } finally { pin.disabled = false; }
    });
    const remove = element('button', 'Abmelden', 'row-action'); remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { await api('/api/sources', { sources: savedConfig.sources.filter(item => item.id !== source.id) }); loaded = false; await refresh(); renderSources(); if (sourceEditing === source.id) resetSource(); $('#sourceResult').textContent = 'Quelle aus der App entfernt. Dateien und Sicherungen bleiben erhalten.'; }
      catch (e) { $('#sourceResult').textContent = e.message; remove.disabled = false; }
    });
    actions.append(edit,pin,remove); row.append(info,actions); $('#sourceList').append(row);
  }
}
$('#resetSource').addEventListener('click', resetSource);
$('#probeSource').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { const check = await api('/api/sources/probe', { path: $('#sourceForm').elements.path.value }); if (!check.ok) throw new Error(check.error); $('#sourceForm').elements.expectedSource.value = check.mount.source; $('#sourceResult').textContent = `Erkannt: ${check.mount.source} · zum Bestätigen Quelle speichern.`; }
  catch (e) { $('#sourceResult').textContent = e.message; } finally { button.disabled = false; }
});
$('#sourceForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const source = {}; for (const key of ['id','name','path','expectedSource','target']) source[key] = form.elements[key].value.trim();
    const errors = validateSourceForm(source, savedConfig.sources, sourceEditing); showFieldErrors(form, errors);
    if (Object.keys(errors).length) throw new Error('Bitte die markierten Quellenfelder korrigieren.');
    const sources = sourceEditing ? savedConfig.sources.map(item => item.id === sourceEditing ? source : item) : [...savedConfig.sources, source];
    const schedule = { days: form.elements.planMode.value === 'manual' ? [] : [...$('#sourceDays').querySelectorAll('button[aria-pressed="true"]')].map(button => Number(button.dataset.day)), time: form.elements.planMode.value === 'manual' ? '' : form.elements.planTime.value };
    await api('/api/sources', { sources, schedule: { id: source.id, value: schedule } }); loaded = false; await refresh(); renderSources(); if (detailId) editSource(source.id, true); else resetSource(); $('#sourceResult').textContent = 'Quelle und Wochenplan gespeichert.';
  } catch (e) { const field = serverField(e); if (field) showFieldErrors(form, { [field]: e.message }); $('#sourceResult').textContent = e.message; } finally { button.disabled = false; }
});
async function openHistory(id) {
  $('#historyTitle').textContent = `Verlauf · ${names[id]}`; $('#historySummary').textContent = 'Wird geladen …'; $('#historyRows').replaceChildren(); showContext('historyDialog', id);
  try {
    const data = await api(`/api/history/${id}`), folder = folderData.find(item => item.id === id), health = lastHealth[id] || folder.health;
    $('#historySummary').textContent = `${folder.path} · Ziel: ${folder.targetRepository || 'Noch nicht konfiguriert'} · ${nextText(health)} (${activeTimezone})${health?.message ? ' · ' + health.message : ''}`;
    if (!data.entries.length) { const row = element('tr'), cell = element('td', 'Noch keine abgeschlossenen App-Läufe.'); cell.colSpan = 5; row.append(cell); $('#historyRows').append(row); }
    for (const entry of data.entries) {
      const row = element('tr'); row.append(element('td', entry.startedAt ? date(entry.startedAt) : 'Unbekannt'), element('td', statuses[entry.status]), element('td', entry.durationSeconds === null ? '—' : `${Math.floor(entry.durationSeconds / 60)} min ${entry.durationSeconds % 60} s`), element('td', entry.source === 'schedule' ? 'Zeitplan' : entry.source === 'manual' ? 'Manuell' : 'Altbestand'));
      const cell = element('td'), button = element('button','Öffnen','row-action'); button.addEventListener('click', () => openLog(id, entry.runId)); cell.append(button); row.append(cell); row.title = [entry.repository && 'Ziel: ' + entry.repository, entry.error].filter(Boolean).join(' · '); const target = element('small', entry.repository || 'Ziel unbekannt', 'history-target'); row.firstElementChild.append(target); $('#historyRows').append(row);
    }
  } catch (e) { $('#historySummary').textContent = e.message; }
}
async function openPBS() {
  $('#pbsFilter').replaceChildren(); const all = element('option','Alle Gruppen'); all.value = ''; $('#pbsFilter').append(all);
  for (const [id,name] of Object.entries(names)) { const option = element('option',name); option.value = id; $('#pbsFilter').append(option); }
  $('#pbsTarget').replaceChildren(...backupTargets().map(target => { const option = element('option', target.name); option.value = target.id; return option; }));
  await loadPBS();
}
async function loadPBS(force = false) {
  $('#refreshPBS').disabled = true; $('#pbsTarget').disabled = true; $('#pbsSummary').textContent = 'PBS-Bestand wird geladen …';
  $('#pbsRows').replaceChildren(); pbsData = null;
  try { const target = $('#pbsTarget').value; pbsData = await api(`/api/pbs${force ? '/refresh' : ''}?target=${encodeURIComponent(target)}`, force ? {} : undefined); renderPBS(); }
  catch (e) { $('#pbsSummary').textContent = e.message; }
  finally { $('#refreshPBS').disabled = false; $('#pbsTarget').disabled = false; }
}
$('#refreshPBS').addEventListener('click', () => loadPBS(true));
$('#pbsTarget').addEventListener('change', () => loadPBS());
$('#pbsFilter').addEventListener('change', renderPBS);
function renderPBS() {
  if (!pbsData) return;
  $('#pbsRows').replaceChildren(); const filter = $('#pbsFilter').value;
  const snapshots = (pbsData.snapshots || []).filter(snapshot => !filter || [filter,`qnap-${filter}`].includes(snapshot.id));
  $('#pbsSummary').textContent = `${pbsData.checkedAt ? 'Stand: ' + date(pbsData.checkedAt) : 'Noch nicht abgerufen – „Vom PBS abrufen“ wählen.'} · ${snapshots.length} Snapshots${pbsData.error ? ' · ' + pbsData.error + ' (ggf. alter Bestand)' : ''}${snapshots.length > 200 ? ' · die neuesten 200 werden angezeigt' : ''}${pbsData.count > 5000 ? ' · Abruf auf 5000 Einträge begrenzt' : ''}`;
  for (const snapshot of snapshots.slice(0,200)) { const row = element('tr'), size = snapshot.size === null ? '—' : `${(snapshot.size / 1024 ** 3).toFixed(2)} GiB`; row.append(element('td', snapshot.group + (snapshot.protected ? ' 🔒' : '')), element('td',date(snapshot.time)), element('td',size), element('td',snapshot.files.join(', ') || '—')); $('#pbsRows').append(row); }
}
function fillNotifications(settings) {
  const form = $('#notifyForm'); form.elements.enabled.checked = settings.enabled;
  let server = 'https://ntfy.sh', topic = '';
  if (settings.url) { const url = new URL(settings.url); const slash = url.pathname.lastIndexOf('/'); server = url.origin + url.pathname.slice(0,slash); try { topic = decodeURIComponent(url.pathname.slice(slash + 1)); } catch { topic = url.pathname.slice(slash + 1); } }
  form.elements.server.value = server; form.elements.topic.value = topic; form.elements.token.value = '';
  form.elements.token.placeholder = settings.hasToken ? 'Token gespeichert · leer lassen' : 'Optionaler ntfy-Token';
  updateNotifyDestination();
}
function notificationPayload() {
  const form = $('#notifyForm'), enabled = form.elements.enabled.checked, server = form.elements.server.value.trim().replace(/\/+$/, ''), topic = form.elements.topic.value.trim();
  const errors = validateNotifyForm({ enabled, server, topic }); showFieldErrors(form, errors);
  if (Object.keys(errors).length) throw new Error('Bitte die markierten ntfy-Felder korrigieren.');
  return { enabled, url: topic ? `${server}/${encodeURIComponent(topic)}` : '', token: form.elements.token.value.trim() };
}
function updateNotifyDestination() {
  try { const form = $('#notifyForm'); const settings = { url: form.elements.topic.value.trim() ? form.elements.server.value.trim().replace(/\/+$/, '') + '/' + encodeURIComponent(form.elements.topic.value.trim()) : '' }; $('#notifyDestination').textContent = settings.url ? `Ziel: ${settings.url}` : 'Server und Topic eintragen. ntfy wird separat gespeichert.'; }
  catch (e) { $('#notifyDestination').textContent = e.message; }
}
$('#notifyForm').addEventListener('input', () => { updateNotifyDestination(); $('#notificationResult').textContent = ''; });
$('#notifyForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true;
  try { const payload = notificationPayload(), stamp = formState.capture('notifyForm'); await api('/api/notifications', payload); if (formState.clean('notifyForm', stamp)) $('#notifyForm').elements.token.value = ''; $('#notificationResult').textContent = payload.enabled ? 'ntfy aktiviert und gespeichert. Jetzt kannst du die Verbindung testen.' : 'ntfy deaktiviert und gespeichert.'; }
  catch (e) { const field = serverField(e); if (field) showFieldErrors($('#notifyForm'), { [field]: e.message }); $('#notificationResult').textContent = e.message; }
  finally { button.disabled = false; }
});
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'), enabled = event.currentTarget.elements.authEnabled.checked, stamp = formState.capture('authForm'); button.disabled = true;
  try { await api('/api/auth', { enabled }); formState.clean('authForm', stamp); $('#logout').hidden = !enabled; $('#authResult').textContent = enabled ? 'Passwortschutz eingeschaltet.' : 'Passwortschutz ausgeschaltet. Zugriff im Netzwerk ohne Anmeldung.'; }
  catch (e) { $('#authResult').textContent = e.message; }
  finally { button.disabled = false; }
});
$('#testNotification').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await api('/api/notifications/test', {}); $('#notificationResult').textContent = 'Testmeldung zugestellt.'; } catch (e) { $('#notificationResult').textContent = e.message; } finally { button.disabled = false; }
});
async function bootstrap() {
  try { const session = await api('/api/session'); if (session.authenticated) { authenticated = true; document.body.classList.remove('locked'); $('#logout').hidden = !session.authEnabled; await refresh(); navigate(); } else showLogin(); }
  catch (e) { showLogin(); $('#loginError').textContent = e.message; }
}
bootstrap();
setInterval(() => { if (authenticated && !polling) refresh(); }, 15000);
setInterval(refreshActivity, 3000);

function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const index = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(bytes / 1024 ** index) + ' ' + units[index];
}
installMaintenance({ api, element, date, isAuthenticated: () => authenticated, getEpoch: () => authEpoch });

$('#showDiscovered').addEventListener('click', () => { renderSources(); resetSource(); location.hash = 'sourcesDialog'; });
function renderDiscovered() {
  $('#discoveredSources').hidden = !mountDiscovery.candidates.length;
  $('#discoveredList').replaceChildren();
  for (const candidate of mountDiscovery.candidates) {
    const row = element('div', undefined, 'discovered-mount'), info = element('div');
    info.append(element('strong', candidate.name), element('code', candidate.path), element('small', candidate.expectedSource));
    const button = element('button', 'Übernehmen', 'secondary'); button.type = 'button'; button.setAttribute('aria-label', `${candidate.name} als Quelle vorbereiten`);
    button.addEventListener('click', () => {
      resetSource(); const form = $('#sourceForm');
      const base = candidate.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32);
      let id = /^[a-z]/.test(base) ? base : 'quelle-' + base;
      const prefix = id.slice(0, 34); let suffix = 2;
      while (savedConfig.sources.some(source => source.id === id)) id = prefix + '-' + suffix++;
      form.elements.id.value = id; form.elements.name.value = candidate.name.slice(0, 60); form.elements.path.value = candidate.path; form.elements.expectedSource.value = candidate.expectedSource;
      $('#sourceResult').textContent = 'Erkannte Freigabe prüfen, Backup-Ziel wählen und mit „Quelle speichern“ hinzufügen.';
      form.elements.name.focus();
    });
    row.append(info, button); $('#discoveredList').append(row);
  }
}

function fillSourcePlan(schedule) {
  const form = $('#sourceForm'); form.elements.planMode.value = schedule.days.length ? 'weekly' : 'manual'; form.elements.planTime.value = schedule.time || '02:00';
  $('#sourceDays').replaceChildren();
  for (let day = 1; day <= 7; day++) { const button = element('button', dayNames[day - 1]); button.type = 'button'; button.dataset.day = day; button.setAttribute('aria-label', 'Sicherung ' + dayNames[day - 1]); button.setAttribute('aria-pressed', String(schedule.days.includes(day))); button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'))); $('#sourceDays').append(button); }
  $('#sourceTimezone').textContent = `Zeitzone: ${activeTimezone} · gilt für alle gewählten Tage.`;
}
function editSource(id, inline = false) {
  const source = savedConfig.sources.find(item => item.id === id); if (!source) return;
  renderSources(); sourceEditing = id; const form = $('#sourceForm'); clearFieldErrors(form);
  for (const key of ['id','name','path','expectedSource']) form.elements[key].value = source[key];
  form.elements.target.value = source.target || 'primary'; form.elements.id.readOnly = true;
  $('#sourceFormTitle').textContent = `Quelle bearbeiten · ${source.name}`; $('#sourceResult').textContent = '';
  fillSourcePlan(savedConfig.schedules[id]);
  if (inline) showContext('sourceForm', id); else form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
fillSourcePlan({ days: [], time: '' });
