import { createAPI } from '/js/api.js';
import { createViews, dayNames } from '/js/views.js';
import { createFormState, clearFieldErrors, showFieldErrors, serverField, validateMainForm, validateNotifyForm, validateSourceForm } from '/js/forms.js';
'use strict';
const refreshWaiters = [];
const $ = selector => document.querySelector(selector);
const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik', daten: 'Daten' };
const statuses = { idle: 'Noch kein Lauf', queued: 'Wartet', running: 'Läuft', success: 'Erfolgreich', failed: 'Fehler', interrupted: 'Unterbrochen' };
let loaded = false, polling = false, logFolder = null, noticeTimer, authenticated = false, activityPolling = false, previousActive = null, authEpoch = 0, activeTimezone = 'Europe/Berlin', savedConfig = null, folderData = [], lastHealth = {}, logRun = null, sourceEditing = null, pbsData = null, sourcePage = 0, lastMainSnapshot = null, lastNotifySnapshot = null;
const api = createAPI(showLogin);
const { element, date, nextText, renderJob, scheduleText } = createViews(() => activeTimezone, statuses);
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
  const mainSnapshot = JSON.stringify([config.repository, config.fingerprint, config.namespace, config.timezone, config.staleAfterDays, config.sources, config.schedules, config.hasPassword]);
  if (!formState.dirty('configForm') && mainSnapshot !== lastMainSnapshot) {
  lastMainSnapshot = mainSnapshot;
  const form = $('#configForm');
  const at = config.repository.lastIndexOf('@'), colon = config.repository.lastIndexOf(':');
  form.elements.authId.value = at > 0 ? config.repository.slice(0, at) : '';
  form.elements.server.value = at > 0 && colon > at ? config.repository.slice(at + 1, colon) : '';
  form.elements.datastore.value = colon > at ? config.repository.slice(colon + 1) : 'pbs1';
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
    $('#targetName').textContent = data.config.repository || 'Noch kein Repository'; $('#flowTarget').textContent = data.config.repository || 'Ziel noch nicht konfiguriert';
    $('#folders').replaceChildren();
    sourcePage = Math.max(0, Math.min(sourcePage, Math.ceil(data.folders.length / 6) - 1));
    $('#overviewPager').hidden = data.folders.length <= 6; $('#sourcePage').textContent = `Seite ${sourcePage + 1} / ${Math.ceil(data.folders.length / 6)}`;
    $('#previousSources').disabled = sourcePage === 0; $('#nextSources').disabled = (sourcePage + 1) * 6 >= data.folders.length;
    for (const folder of data.folders.slice(sourcePage * 6, (sourcePage + 1) * 6)) {
      const row = element('tr'); row.dataset.folder = folder.id; const source = element('td'); const sourceButton = element('button', names[folder.id], 'source-link'); sourceButton.title = 'Verlauf und Details öffnen'; sourceButton.addEventListener('click', () => openHistory(folder.id)); source.append(sourceButton, element('code', folder.path)); row.append(source);
      const mount = element('td'), badge = element('span', folder.ok ? '● Eingebunden' : '● Nicht verfügbar', `badge ${folder.ok ? 'ok' : 'bad'}`); badge.title = folder.ok ? `${folder.mount.source} → ${folder.mount.target} (${folder.mount.type}) · ${folder.identityConfirmed ? 'SMB-Identität bestätigt' : 'SMB-Quelle noch nicht festgelegt: unter Quellen bestätigen'}` : folder.error; mount.append(badge); row.append(mount);
      const plan = element('td'); plan.append(element('span', scheduleText(folder.schedule)), element('small', nextText(folder.health), 'next-run')); plan.title = `${scheduleText(folder.schedule)} · ${nextText(folder.health)} (${activeTimezone})`;
      row.append(plan, element('td', date(folder.job.lastSuccess)));
      const state = element('td'); state.className = 'job-state'; renderJob(state, folder.job, folder.health); row.append(state); const status = folder.job.status;
      const actions = element('td'), start = element('button', '↗ Sichern', 'row-action'), logs = element('button', 'Protokoll', 'row-action');
      start.dataset.start = folder.id; start.dataset.available = String(Boolean(folder.ok && data.config.repository && data.config.hasPassword));
      start.disabled = !folder.ok || !data.config.repository || !data.config.hasPassword || ['running', 'queued'].includes(status);
      start.addEventListener('click', async () => { start.disabled = true; try { await api(`/api/backup/${folder.id}`, {}); notice(`${names[folder.id]} zur Sicherung vorgemerkt.`); await refresh(); } catch (e) { notice(e.message, true); start.disabled = false; } });
      logs.addEventListener('click', () => openLog(folder.id)); actions.append(start, logs); row.append(actions); $('#folders').append(row);
    }
    $('#systemInfo').replaceChildren();
    for (const [label, value] of [['Host', data.system.hostname], ['System', data.system.platform], ['Backup Client', data.system.client], ['Zeitpläne', data.system.timezone]]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#systemInfo').append(item); }
    fillForm(data.config); loaded = true;
    if (data.connection) $('#connectionResult').textContent = `${data.connection.message} (${date(data.connection.checkedAt)})`;
    await refreshActivity();
  } catch (e) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; if (authenticated) notice(e.message, true); } finally { polling = false; if (refreshWaiters.length) { const waiters = refreshWaiters.splice(0); await refresh(); for (const resolve of waiters) resolve(); } }
}
async function refreshLog() { try { const data = await api(logRun ? `/api/history/${logFolder}/${logRun}` : `/api/logs/${logFolder}`); const pre = $('#logText'), bottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40; pre.textContent = data.log; if (bottom) pre.scrollTop = pre.scrollHeight; } catch (e) { notice(e.message, true); } }
async function openLog(id, runId = null) { logFolder = id; logRun = runId; $('#logTitle').textContent = `Protokoll · ${names[id]}`; $('#logText').textContent = 'Wird geladen …'; $('#logDialog').showModal(); await refreshLog(); }
$('#liveDetails').addEventListener('click', () => { if (previousActive) openLog(previousActive); });
$('#closeLog').addEventListener('click', () => $('#logDialog').close()); $('#logDialog').addEventListener('close', () => { logFolder = null; logRun = null; });
function navigate(page) { if (!['overview', 'settings', 'guide'].includes(page)) page = 'overview'; document.body.dataset.page = page; document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page); document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === page)); }
document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.page; })); window.addEventListener('hashchange', () => navigate(location.hash.slice(1))); navigate(location.hash.slice(1));
$('#refresh').addEventListener('click', refresh);
$('#previousSources').addEventListener('click', () => { sourcePage = Math.max(0, sourcePage - 1); void refresh(); });
$('#nextSources').addEventListener('click', () => { sourcePage++; void refresh(); });
$('#configForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!loaded) return notice('Konfiguration zuerst laden.', true);
  const form = event.currentTarget, button = form.querySelector('[type=submit]'), data = { schedules: {} };
  const target = Object.fromEntries(['server','authId','datastore'].map(key => [key, form.elements[key].value.trim()]));
  data.repository = target.server || target.authId || form.elements.password.value ? `${target.authId}@${target.server}:${target.datastore}` : '';
  for (const key of ['password', 'fingerprint', 'namespace', 'timezone']) data[key] = form.elements[key].value;
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
  try { const data = await api('/api/connection', {}); $('#connectionResult').textContent = data.message; notice(data.message, !data.ok); await refresh(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; }
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
  try { await api('/api/login', { password: $('#loginPassword').value }); authenticated = true; $('#loginPassword').value = ''; $('#loginDialog').close(); document.body.classList.remove('locked'); await refresh(); }
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
    if (data.active) {
      const job = data.jobs[data.active];
      $('#activityTitle').textContent = `${names[data.active]} · ${data.phase === 'checking' ? 'Quelle wird geprüft' : 'Backup läuft'}`;
      $('#activityDescription').textContent = 'Der Auftrag läuft im LXC weiter, auch wenn du die Seite schließt.';
      for (const [label, value] of [['Gestartet', date(job.startedAt)], ['Laufzeit', duration(job.startedAt)], ['Auslöser', job.source === 'schedule' ? 'Zeitplan' : 'Manuell']]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#activityMeta').append(item); }
      $('#liveDetails').hidden = false;

    } else {
      $('#activityTitle').textContent = 'Gerade läuft kein Backup';
      const latest = Object.entries(data.jobs).filter(([, job]) => job.endedAt).sort((a, b) => b[1].endedAt.localeCompare(a[1].endedAt))[0];
      if (latest && ['failed', 'interrupted'].includes(latest[1].status)) { $('#activityBadge').textContent = 'Letzter Lauf mit Fehler'; $('#activityBadge').className = 'badge bad'; }
      $('#activityDescription').textContent = latest ? `Letzter Lauf: ${names[latest[0]]} · ${statuses[latest[1].status]} · ${date(latest[1].endedAt)}${latest[1].error ? ' · ' + latest[1].error : ''}` : 'Starte unten eine Sicherung oder hinterlege einen Wochenplan in den Einstellungen.';
      $('#liveDetails').hidden = true;
    }
    $('#activityDescription').title = $('#activityDescription').textContent;
    previousActive = data.active;
    $('#queueInfo').textContent = data.queue.length ? `Danach: ${data.queue.map(id => names[id]).join(' → ')}` : 'Keine weiteren Aufträge in der Warteschlange.';
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
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $('#' + button.dataset.close).close()));
$('#manageSources').addEventListener('click', () => { if (!savedConfig) return; renderSources(); resetSource(); $('#sourcesDialog').showModal(); });
function resetSource() {
  sourceEditing = null; clearFieldErrors($('#sourceForm')); $('#sourceForm').reset(); $('#sourceForm').elements.id.readOnly = false; $('#sourceFormTitle').textContent = 'Quelle hinzufügen'; $('#sourceResult').textContent = '';
}
function renderSources() {
  $('#sourceList').replaceChildren();
  for (const source of savedConfig.sources) {
    const row = element('div', undefined, 'source-editor-row'), info = element('div');
    info.append(element('strong', source.name), element('code', source.path), element('small', source.expectedSource || 'SMB-Identität noch nicht festgelegt', 'hint'));
    const detected = folderData.find(item => item.id === source.id)?.mount?.source; if (detected) info.append(element('small', `Aktuell erkannt: ${detected}`, 'hint'));
    const actions = element('div', undefined, 'source-editor-actions');
    const edit = element('button', 'Bearbeiten', 'row-action'); edit.addEventListener('click', () => {
      sourceEditing = source.id; const form = $('#sourceForm'); clearFieldErrors(form); for (const key of ['id','name','path','expectedSource']) form.elements[key].value = source[key]; form.elements.id.readOnly = true; $('#sourceFormTitle').textContent = `Quelle bearbeiten · ${source.name}`; $('#sourceResult').textContent = '';
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
    const source = {}; for (const key of ['id','name','path','expectedSource']) source[key] = form.elements[key].value.trim();
    const errors = validateSourceForm(source, savedConfig.sources, sourceEditing); showFieldErrors(form, errors);
    if (Object.keys(errors).length) throw new Error('Bitte die markierten Quellenfelder korrigieren.');
    const sources = sourceEditing ? savedConfig.sources.map(item => item.id === sourceEditing ? source : item) : [...savedConfig.sources, source];
    await api('/api/sources', { sources }); loaded = false; await refresh(); renderSources(); resetSource(); $('#sourceResult').textContent = 'Quelle gespeichert. Zeitplan unter Einstellungen festlegen.';
  } catch (e) { const field = serverField(e); if (field) showFieldErrors(form, { [field]: e.message }); $('#sourceResult').textContent = e.message; } finally { button.disabled = false; }
});
async function openHistory(id) {
  $('#historyTitle').textContent = `Verlauf · ${names[id]}`; $('#historySummary').textContent = 'Wird geladen …'; $('#historyRows').replaceChildren(); $('#historyDialog').showModal();
  try {
    const data = await api(`/api/history/${id}`), folder = folderData.find(item => item.id === id), health = lastHealth[id] || folder.health;
    $('#historySummary').textContent = `${folder.path} · ${nextText(health)} (${activeTimezone})${health?.message ? ' · ' + health.message : ''}`;
    if (!data.entries.length) { const row = element('tr'), cell = element('td', 'Noch keine abgeschlossenen App-Läufe.'); cell.colSpan = 5; row.append(cell); $('#historyRows').append(row); }
    for (const entry of data.entries) {
      const row = element('tr'); row.append(element('td', entry.startedAt ? date(entry.startedAt) : 'Unbekannt'), element('td', statuses[entry.status]), element('td', entry.durationSeconds === null ? '—' : `${Math.floor(entry.durationSeconds / 60)} min ${entry.durationSeconds % 60} s`), element('td', entry.source === 'schedule' ? 'Zeitplan' : entry.source === 'manual' ? 'Manuell' : 'Altbestand'));
      const cell = element('td'), button = element('button','Öffnen','row-action'); button.addEventListener('click', () => openLog(id, entry.runId)); cell.append(button); row.append(cell); row.title = entry.error || ''; $('#historyRows').append(row);
    }
  } catch (e) { $('#historySummary').textContent = e.message; }
}
$('#showPBS').addEventListener('click', async () => {
  $('#pbsFilter').replaceChildren(); const all = element('option','Alle Gruppen'); all.value = ''; $('#pbsFilter').append(all);
  for (const [id,name] of Object.entries(names)) { const option = element('option',name); option.value = id; $('#pbsFilter').append(option); }
  $('#pbsDialog').showModal(); $('#pbsSummary').textContent = 'Bestand wird geladen …';
  try { pbsData = await api('/api/pbs'); renderPBS(); } catch (e) { $('#pbsSummary').textContent = e.message; }
});
$('#refreshPBS').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#pbsSummary').textContent = 'PBS wird abgefragt …';
  try { pbsData = await api('/api/pbs/refresh', {}); renderPBS(); } catch (e) { $('#pbsSummary').textContent = e.message; } finally { button.disabled = false; }
});
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
  try { const session = await api('/api/session'); if (session.authenticated) { authenticated = true; document.body.classList.remove('locked'); $('#logout').hidden = !session.authEnabled; await refresh(); } else showLogin(); }
  catch (e) { showLogin(); $('#loginError').textContent = e.message; }
}
bootstrap();
setInterval(() => { if (authenticated && !polling) refresh(); }, 15000);
setInterval(refreshActivity, 3000);
