import { installStrategy } from '/js/strategy.js';
import { installPartitions } from '/js/partitions.js';
import { installSourceHelp } from '/js/source-help.js';
import { installLogbook } from '/js/logbook.js';
import { installDashboard } from '/js/dashboard.js';
import { installDrive } from '/js/gdrive.js';
import { installRestore } from '/js/restore.js';
import { installControls } from '/js/controls.js';
import { installOperations } from '/js/operations.js';
import { installTimeline } from '/js/timeline.js';
import { sourceProblem, sourceHealth, latestConnection } from '/js/problems.js';
import { installAssistant, installMountTools } from '/js/assistant.js';
import { installMaintenance } from '/js/maintenance.js';
import { createAPI } from '/js/api.js';
import { createViews, dayNames } from '/js/views.js';
import { createFormState, clearFieldErrors, showFieldErrors, serverField, validateMainForm, validateNotifyForm, validateSourceForm } from '/js/forms.js';
'use strict';
let additionalTargetsSnapshot = null;
let strategyUI, partitionTools, assistant, timeline, operations, controls, restore, drive, dashboard;
let lastTargets = [], lastConnections = {}, lastCapacities = {}, lastPreferencesSnapshot = null;
const refreshWaiters = [];
const $ = selector => document.querySelector(selector);
const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik', daten: 'Daten' };
const statuses = { skipped:'Noch keine Dateien', idle: 'Noch kein Lauf', queued: 'Wartet', running: 'Läuft', success: 'Erfolgreich', failed: 'Fehler', interrupted: 'Unterbrochen', cancelling: 'Wird abgebrochen', cancelled: 'Abgebrochen' };
let loaded = false, polling = false, noticeTimer, authenticated = false, activityPolling = false, previousActive = null, authEpoch = 0, activeTimezone = 'Europe/Berlin', savedConfig = null, folderData = [], lastHealth = {}, sourceEditing = null, pbsData = null, sourcePage = 0, lastMainSnapshot = null, lastNotifySnapshot = null, mountDiscovery = { candidates: [] };
const api = createAPI(showLogin);
const { element, date, nextText, renderJob, scheduleText, renderEstimate } = createViews(() => activeTimezone, statuses);
const formState = createFormState(['configForm', 'preferencesForm', 'authForm', 'notifyForm'].map(id => document.getElementById(id)));
function notice(message, error = false) {
  $('#notice').textContent = message; $('#notice').classList.toggle('error', error); $('#notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('#notice').hidden = true, 12000);
}
const presets = { manual: [], daily: [1,2,3,4,5,6,7], weekdays: [1,2,3,4,5], weekend: [6,7] };
function fillForm(config) {
  renderAdditionalTargets(config);
  const mainSnapshot = JSON.stringify([config.repository, config.secondaryDatastore, config.secondaryPBS, config.additionalDatastores, config.fingerprint, config.namespace, config.capacityWarnPercent, config.hasPassword]);
  if (!formState.dirty('configForm') && mainSnapshot !== lastMainSnapshot) {
  lastMainSnapshot = mainSnapshot;
  const form = $('#configForm');
  const at = config.repository.lastIndexOf('@'), colon = config.repository.lastIndexOf(':');
  form.elements.authId.value = at > 0 ? config.repository.slice(0, at) : '';
  form.elements.server.value = at > 0 && colon > at ? config.repository.slice(at + 1, colon) : '';
  form.elements.datastore.value = colon > at ? config.repository.slice(colon + 1) : 'pbs1';
  form.elements.capacityWarnPercent.value = config.capacityWarnPercent;
  form.elements.secondaryDatastore.value = config.secondaryDatastore || '';
  form.elements.secondaryOwnServer.checked = Boolean(config.secondaryPBS); $('#secondaryFields').hidden = !config.secondaryPBS; $('#secondaryAccess').open = Boolean(config.secondaryPBS);
  for (const [field, key] of [['secondaryServer','server'],['secondaryAuthId','authId'],['secondaryFingerprint','fingerprint'],['secondaryNamespace','namespace']]) form.elements[field].value = config.secondaryPBS?.[key] || '';
  form.elements.secondaryPassword.value = '';
  for (const key of ['fingerprint', 'namespace']) form.elements[key].value = config[key];
  $('#repositoryPreview').textContent = config.repository || 'Noch nicht gespeichert';
  form.elements.password.value = '';
  $('#passwordHint').textContent = config.hasPassword ? 'PBS-Passwort gespeichert · leer lassen zum Beibehalten.' : 'PBS-Passwort noch nicht hinterlegt.';

  }
  if (!formState.dirty('authForm')) { $('#authForm').elements.authEnabled.checked = config.authEnabled; $('#authResult').textContent = config.authEnabled ? 'Passwortschutz ist eingeschaltet.' : 'Zugriff im Netzwerk ohne App-Passwort.'; }
  $('#logout').hidden = !config.authEnabled;
  const notifySnapshot = JSON.stringify(config.notifications);
  if (!formState.dirty('notifyForm') && notifySnapshot !== lastNotifySnapshot) { fillNotifications(config.notifications); lastNotifySnapshot = notifySnapshot; }
  const preferenceSnapshot = JSON.stringify([config.timezone, config.staleAfterDays]);
  if (!formState.dirty('preferencesForm') && preferenceSnapshot !== lastPreferencesSnapshot) {
    lastPreferencesSnapshot = preferenceSnapshot; const form = $('#preferencesForm');
    if (![...form.elements.timezone.options].some(option => option.value === config.timezone)) { const option = element('option', config.timezone); option.value = config.timezone; form.elements.timezone.append(option); }
    form.elements.timezone.value = config.timezone; form.elements.staleAfterDays.value = config.staleAfterDays;
  }
}
async function refresh() {
  if (polling) return new Promise(resolve => refreshWaiters.push(resolve)); polling = true; const epoch = authEpoch;
  try {
    const data = await api('/api/status');
    if (epoch !== authEpoch) return;
    mountDiscovery = data.discovery || { candidates: [] };
    $('#showDiscovered').hidden = !mountDiscovery.candidates.length;
    $('#showDiscovered').textContent = `Neue Netzwerkfreigaben (${mountDiscovery.candidates.length})`;
    lastTargets = data.targets || []; lastConnections = data.connections || {}; lastCapacities = data.capacities || {};
    savedConfig = data.config; activeTimezone = data.config.timezone; folderData = data.folders;
    for (const key of Object.keys(names)) delete names[key]; for (const source of data.config.sources) names[source.id] = source.name;
    $('#appVersion').textContent = `v${data.system.version}`;
    document.dispatchEvent(new Event('check-version-status'));
    $('#systemChecks').replaceChildren(...data.system.checks.map(check => element('li', `${check.ok ? '✓' : '⚠'} ${check.name}: ${check.message}`, check.ok ? 'check-ok' : 'check-warning')));
    $('#sidebarTimezone').textContent = activeTimezone; $('#sourceCount').textContent = data.folders.length;
    authenticated = true; document.body.classList.remove('locked'); if ($('#loginDialog').open) $('#loginDialog').close();
    $('#updated').textContent = `Aktualisiert ${new Date().toLocaleTimeString('de-DE', { timeZone: activeTimezone })} · live`;
    $('#mountCount').textContent = `${data.folders.filter(f => f.ok).length} / ${data.folders.length}`;
    $('#runningCount').textContent = data.folders.filter(f => ['running', 'queued', 'cancelling'].includes(f.job.status)).length;
    $('#targetStatus').textContent = data.connection ? (data.connection.ok ? 'Verbunden' : 'Prüfung fehlgeschlagen') : 'Ungeprüft';
    $('#targetName').textContent = data.targets?.map(target => target.name).join(' · ') || data.config.repository || 'Noch kein Repository';
    $('#targetName').title = (data.targets || []).map(target => target.repository).join(' · ');
    const checks = Object.values(data.connections || {}).filter(Boolean);
    if (data.targets?.length > 1) $('#targetStatus').textContent = checks.length ? `${checks.filter(check => check.ok).length} / ${data.targets.length} geprüft OK` : 'Ungeprüft'; $('#flowTarget').textContent = data.config.repository || 'Ziel noch nicht konfiguriert';
    $('#folders').replaceChildren();
    sourcePage = Math.max(0, Math.min(sourcePage, Math.ceil(data.folders.length / 6) - 1));
    $('#overviewPager').hidden = true; $('#sourcePage').textContent = `Seite ${sourcePage + 1} / ${Math.ceil(data.folders.length / 6)}`;
    $('#previousSources').disabled = sourcePage === 0; $('#nextSources').disabled = (sourcePage + 1) * 6 >= data.folders.length;
    for (const folder of data.folders.filter(item=>!item.partitioned&&item.target!=='gdrive')) {
      const row = element('tr'); row.dataset.folder = folder.id; const source = element('td'); const sourceButton = element('button', names[folder.id], 'source-link'); sourceButton.title = 'Details, Zeitplan und Verlauf öffnen'; sourceButton.addEventListener('click', () => openHistory(folder.id)); const path = element('code', folder.path); path.title = folder.path; const target = element('small', folder.targetRepository?.split(':').at(-1) || 'Ziel fehlt', 'source-target'); target.title = folder.targetRepository || 'PBS-Ziel noch nicht konfiguriert'; const heading = element('div', undefined, 'source-heading'); heading.append(sourceButton); source.append(heading, path);if(folder.selection)source.append(element('small',folder.selection.length+' ausgewählte Dateien','hint')); row.append(source);
      const mount = element('td'), badge = element('span', folder.ok ? '● Eingebunden' : folder.checking ? '● Prüfung läuft' : ['cifs','smb3','nfs','nfs4'].includes(folder.mount?.type) && folder.mount?.source && folder.expectedSource && folder.mount.source !== folder.expectedSource ? '● Mount geändert' : '● Nicht verfügbar', `badge ${folder.ok ? 'ok' : folder.checking ? 'busy' : 'bad'}`); badge.title = folder.ok ? `${folder.mount.source} → ${folder.mount.target} (${folder.mount.type}) · ${folder.identityConfirmed ? 'Mount-Identität bestätigt' : 'Mount-Quelle noch nicht festgelegt: unter Quellen bestätigen'}` : `${folder.error}${folder.mount?.source ? ' Erkannt: ' + folder.mount.source : ''}`; if (folder.checking) badge.title += ' · Lesbarkeit wird im Hintergrund geprüft'; if (folder.checkedAt) badge.title += ' · Letzte Prüfung: ' + date(folder.checkedAt); mount.append(badge);
      const size = folder.size;
      const sizeLabel = size?.bytes != null ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(size.bytes / 1024 ** 3) + ' GiB' : ({ scanning: 'Größe wird ermittelt …', pending: 'Größe vorgemerkt …', error: 'Größe nicht verfügbar' }[size?.status] || (folder.mount?.source && !folder.ok ? 'Erkannt: ' + folder.mount.source : 'Größe: —'));
      const sizeInfo = element('small', sizeLabel, 'source-size');
      sizeInfo.title = size?.error || `Dateigröße der Quelle (unkomprimiert)${size?.checkedAt ? ' · Stand: ' + date(size.checkedAt) : ''} · Automatisch alle 6 Stunden oder über „Aktualisieren“. Große Freigaben können länger dauern.`;
      mount.append(sizeInfo); source.append(...mount.childNodes); const destination=element('td');destination.append(element('strong','PBS'),target,element('small','Sicherung mit Versionen','job-mode'));row.append(destination);
      const plan = element('td'); plan.append(element('span', scheduleText(folder.schedule)),element('small',activeTimezone,'hint'));const next=element('td',undefined,'job-next');next.append(element('strong',folder.health?.nextAt ? date(folder.health.nextAt) : 'Nur manuell','next-run')); plan.classList.add('plan-link'); plan.tabIndex = 0; plan.setAttribute('role', 'button'); plan.setAttribute('aria-label', `Zeitplan ${names[folder.id]} bearbeiten`); plan.addEventListener('click', () => editSource(folder.id, true)); plan.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editSource(folder.id, true); } }); plan.title = `${scheduleText(folder.schedule)} · ${nextText(folder.health)} (${activeTimezone})`;
      const success = element('td'); success.className = 'source-health'; renderSourceHealth(success, folder, folder.job, folder.health); row.append(plan, next, success);
      const state = element('td'); state.className = 'job-state'; renderFolderState(state, folder, folder.job, folder.health); row.append(state); const status = folder.job.status;
      const actions = element('td'), start = element('button', 'Starten', 'row-action');
      const targetReady = data.targets?.find(target => target.id === (folder.target || 'primary'))?.hasPassword ?? data.config.hasPassword;
      start.dataset.start = folder.id; start.dataset.available = String(Boolean(folder.ok && folder.targetRepository && targetReady));
      start.hidden = ['running','queued','cancelling'].includes(status);
      start.disabled = !folder.ok || !folder.targetRepository || !targetReady || ['running', 'queued', 'cancelling'].includes(status);
      start.addEventListener('click', async () => { start.disabled = true; try { await api(`/api/backup/${folder.id}`, {}); notice(`${names[folder.id]} zur Sicherung vorgemerkt.`); await refresh(); } catch (e) { notice(e.message, true); start.disabled = false; } });
      const cancel = element('button', 'Abbrechen', 'row-action'); cancel.dataset.cancel = folder.id; cancel.hidden = !['running','queued','cancelling'].includes(status); cancel.disabled = status === 'cancelling'; cancel.addEventListener('click', () => cancelBackup(folder.id)); const edit=element('button','Bearbeiten','row-action');edit.type='button';edit.addEventListener('click',()=>editSource(folder.id,true));actions.append(start, cancel, edit); row.append(actions); $('#folders').append(row);
    }
    $('#systemInfo').replaceChildren();
    for (const [label, value] of [['Host', data.system.hostname], ['System', data.system.platform], ['Backup Client', data.system.client], ['Zeitpläne', data.system.timezone]]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#systemInfo').append(item); }
    if (data.folders.some(folder => folder.checking)) setTimeout(() => { if (authenticated) void refresh(); }, 1000);
    fillForm(data.config); drive?.update(data.drive); loaded = true; $('#backupAll').disabled = false; timeline?.update(data.timeline); operations?.update(data); dashboard?.update(data); strategyUI?.update(data); controls?.update(data); if (document.body.dataset.page === 'sourcesDialog' && !$('#sourceList').contains(document.activeElement)) renderSources(); if (sourceEditing) renderSourceProblem(sourceEditing);
    const connectionMessages = (data.targets || []).filter(target => data.connections?.[target.id]).map(target => `${target.name}: ${data.connections[target.id].message} (${date(data.connections[target.id].checkedAt)})`);
    $('#connectionResult').textContent = connectionMessages.join(' · ');
    await refreshActivity();
  } catch (e) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; if (authenticated) notice(e.message, true); } finally { polling = false; if (refreshWaiters.length) { const waiters = refreshWaiters.splice(0); await refresh(); for (const resolve of waiters) resolve(); } }
}
function openLog(id, runId = null) { location.hash = 'logs/' + id + (runId ? '/' + runId : ''); }
let detailId = null;
const homes = new Map(['sourceForm','historyDialog','restorePanel'].map(id => [id, { parent: $('#' + id).parentNode, next: $('#' + id).nextSibling }]));
function restoreContext() {
  for (const [id, home] of homes) home.parent.insertBefore($('#' + id), home.next?.parentNode === home.parent ? home.next : null);
  $('#sourceDetail').hidden = true; $('#historyDialog').hidden = true; $('#restorePanel').hidden = true;
  detailId = null;
}
function closeContext() { location.hash = document.body.dataset.page === 'sourcesDialog' && detailId ? '#sourcesDialog' : '#jobs'; }
function showContext(view, id) {
  const base = ['jobs','sourcesDialog'].includes(document.body.dataset.page) ? document.body.dataset.page : 'jobs';
  const route = `${base}/${id}/${view === 'historyDialog' ? 'history' : view === 'restorePanel' ? 'restore' : 'edit'}`;
  if (location.hash.slice(1) !== route) history.pushState(null, '', '#' + route);
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== base);
  document.body.dataset.page = base; markNavigation(base); $('#' + base).append($('#sourceDetail'));
  if (base === 'jobs') $('#jobsActivitySlot').append($('.activity'));
  $('#sourceDetail').hidden = false; detailId = id; $('#detailTitle').textContent = names[id] || id;
  const slots = { sourceForm: 'detailEditor', historyDialog: 'detailHistorySlot', restorePanel: 'detailRestoreSlot' };
  for (const [key, slot] of Object.entries(slots)) { $('#' + slot).hidden = key !== view; if (key === view) { $('#' + slot).append($('#' + key)); $('#' + key).hidden = false; } }
  document.querySelectorAll('.detail-tabs button').forEach(button => button.classList.toggle('active', button.id === ({ sourceForm: 'detailEdit', historyDialog: 'detailHistory', restorePanel: 'detailRestore' })[view]));
  $('#sourceDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function markNavigation(page, id) {
  const selected = page === 'mountTools' ? 'sourcesDialog' : page === 'pbsDialog' ? 'targets' : page === 'assistant' ? id === 'pbs' ? 'targets' : 'sourcesDialog' : page;
  document.querySelectorAll('aside .nav[data-page]').forEach(link => {
    const active = link.dataset.page === selected; link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}
function navigate() {
  restoreContext();
  if (location.hash === '#systemDialog') { history.replaceState(null, '', '#settings'); $('#systemMaintenance').open = true; }
  if (/^#overview\/[a-z][a-z0-9_-]*\/(edit|history|restore|log)$/.test(location.hash)) history.replaceState(null, '', location.hash.replace('#overview/', '#jobs/'));
  const [requested, id, tab] = location.hash.slice(1).split('/');
  const page = ['overview','settings','targets','guide','sourcesDialog','pbsDialog','mountTools','logs','jobs','assistant','strategy','schedule'].includes(requested) ? requested : 'overview';
  document.body.dataset.page = page;
  if (!id || page === 'assistant') window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page);
  markNavigation(page, id);
  (page === 'jobs' ? $('#jobsActivitySlot') : $('#overviewActivitySlot')).append($('.activity'));
  if (!savedConfig) return;
  if (page === 'assistant') assistant?.open(id);
  if (page === 'strategy' || page === 'schedule') strategyUI?.open(page,id,tab);
  if (page === 'mountTools') document.dispatchEvent(new Event('open-mount-tools'));
  if (page === 'sourcesDialog') renderSources();
  if (page === 'pbsDialog') openPBS(id);
  if (page === 'logs') document.dispatchEvent(new Event('open-logbook'));
  if (page === 'settings') document.dispatchEvent(new Event('open-system'));
  if (['overview','jobs','sourcesDialog'].includes(page) && names[id]) { if (tab === 'restore') void restore?.open(id); else if (tab === 'log') void openLog(id); else if (tab === 'history') void openHistory(id); else editSource(id, true); }
}
window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate);
$('#closeDetail').addEventListener('click', closeContext);
$('#detailEdit').addEventListener('click', () => editSource(detailId, true));
$('#detailHistory').addEventListener('click', () => openHistory(detailId));
$('#detailRestore').addEventListener('click', () => restore.open(detailId));
navigate();
$('#backupAll').addEventListener('click', async () => {
  const button = $('#backupAll'); button.disabled = true;
  try {
    const result = await api('/api/backups/start', {});
    const skipped = result.skipped.length ? ' Übersprungen: ' + result.skipped.map(source => `${source.name} (${source.reason})`).join(', ') : '';
    notice((result.added.length ? `${result.added.length} Sicherungen vorgemerkt. Sie laufen automatisch nacheinander.` : 'Keine zusätzlichen Sicherungen vorgemerkt.') + skipped);
    await refresh();
  } catch (e) { notice(e.message, true); }
  finally { button.disabled = false; }
});
$('#refresh').addEventListener('click', async () => {
  const button = $('#refresh'); button.disabled = true; button.textContent = '↻ Prüfe Mounts …';
  try {
    const result = await api('/api/refresh', {});
    await refresh();
    setTimeout(() => { if (authenticated) void refresh(); }, 1500);
    notice(result.discovery.error || (result.sizeDeferred ? 'Mount-Zuordnung aktualisiert; Lesbarkeit wird im Hintergrund geprüft. Größenmessungen warten auf das Ende laufender Sicherungen bzw. der Wartung.' : 'Mount-Zuordnung aktualisiert. Lesbarkeit und Größen werden im Hintergrund geprüft.') + (result.discovery.candidates.length ? ` ${result.discovery.candidates.length} neue Netzwerkfreigabe(n) erkannt.` : ''), Boolean(result.discovery.error));
  } catch (e) { notice(e.message, true); }
  finally { button.disabled = false; button.textContent = '↻ Aktualisieren'; }
});
$('#previousSources').addEventListener('click', () => { sourcePage = Math.max(0, sourcePage - 1); void refresh(); });
$('#nextSources').addEventListener('click', () => { sourcePage++; void refresh(); });
$('#configForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!loaded) return notice('Konfiguration zuerst laden.', true);
  const form = event.currentTarget, button = form.querySelector('[type=submit]'), data = {};
  const target = {...Object.fromEntries(['server','authId'].map(key => [key, form.elements[key].value.trim()])),datastore:savedConfig.repository.split(':').at(-1)||'pbs1'};
  data.repository = target.server || target.authId || form.elements.password.value ? `${target.authId}@${target.server}:${target.datastore}` : '';
  for (const key of ['password', 'fingerprint', 'namespace']) data[key] = form.elements[key].value;
  data.secondaryDatastore=savedConfig.secondaryDatastore||'';
  data.capacityWarnPercent = Number(form.elements.capacityWarnPercent.value);
  data.secondaryPBS = form.elements.secondaryOwnServer.checked ? Object.fromEntries([['server','secondaryServer'],['authId','secondaryAuthId'],['password','secondaryPassword'],['fingerprint','secondaryFingerprint'],['namespace','secondaryNamespace']].map(([key, field]) => [key, form.elements[field].value])) : null;
  const errors = validateMainForm({ ...savedConfig, ...target, ...data }); showFieldErrors(form, errors);
  if (Object.keys(errors).length) { $('#settingsResult').textContent = 'Bitte die markierten Felder korrigieren.'; return; }
  const stamp = formState.capture('configForm');
  button.disabled = true; $('#settingsResult').textContent = '';
  try { await api('/api/targets', data); const clean = formState.clean('configForm', stamp); if (clean) lastMainSnapshot = null; loaded = false; await refresh(); $('#settingsResult').textContent = clean ? 'Gespeichert. Die Verbindung kannst du separat prüfen.' : 'Gespeichert. Neuere Eingaben sind noch ungespeichert.'; } catch (e) { const field = serverField(e); if (field) showFieldErrors(form, { [field]: e.message }); $('#settingsResult').textContent = e.message; notice(e.message, true); } finally { button.disabled = false; }
});
$('#preferencesForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!savedConfig) return;
  const form = event.currentTarget, button = form.querySelector('[type=submit]'), data = { timezone: form.elements.timezone.value, staleAfterDays: Number(form.elements.staleAfterDays.value) };
  const errors = validateMainForm({ ...savedConfig, ...data, server: '', authId: '', datastore: '', secondaryDatastore: '', secondaryPBS: null, password: '', schedules: {} }); showFieldErrors(form, errors);
  if (Object.keys(errors).length) { $('#preferencesResult').textContent = 'Bitte die markierten Felder korrigieren.'; return; }
  const stamp = formState.capture('preferencesForm'); button.disabled = true;
  try { await api('/api/preferences', data); const clean = formState.clean('preferencesForm', stamp); if (clean) lastPreferencesSnapshot = null; await refresh(); $('#preferencesResult').textContent = clean ? 'Allgemeine Einstellungen gespeichert.' : 'Gespeichert. Neuere Eingaben sind noch ungespeichert.'; }
  catch (e) { const field = serverField(e); if (field) showFieldErrors(form, { [field]: e.message }); $('#preferencesResult').textContent = e.message; }
  finally { button.disabled = false; }
});
$('#testConnection').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#connectionResult').textContent = 'Verbindung wird geprüft …';
  try { const results = []; for (const target of backupTargets()) { const data = await api('/api/connection', { target: target.id }); results.push(`${target.name}: ${data.message}`); } await refresh(); $('#connectionResult').textContent = results.join(' · '); } catch (e) { $('#connectionResult').textContent = 'Verbindungsprüfung fehlgeschlagen: ' + e.message + ' Zugang, Datastore und Fingerprint prüfen.'; notice(e.message, true); } finally { button.disabled = false; }
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
async function cancelBackup(id) {
  try {
    await api(id ? `/api/backup/${id}/cancel` : '/api/backups/cancel', {});
    notice(id ? `${names[id]}: Abbruch angefordert.` : 'Alle Aufträge werden abgebrochen. Warte auf „Bereit“, bevor du aktualisierst.');
    await refreshActivity(); await refresh();
  } catch (e) { notice(e.message, true); }
}
$('#cancelAll').addEventListener('click', () => cancelBackup());
async function refreshActivity() {
  if (!authenticated || activityPolling) return;
  activityPolling = true; const epoch = authEpoch;
  try {
    const data = await api('/api/activity');
    if (epoch !== authEpoch) return;
    drive?.update(data.drive); dashboard?.activity(data);
    $('#activityMeta').replaceChildren();
    $('#activityBadge').textContent = data.active ? data.jobs[data.active].status === 'cancelling' ? 'Abbruch läuft' : '● Läuft' : '● Bereit';
    $('#cancelAll').hidden = !data.active && !data.queue.length;
    $('#cancelAll').disabled = Boolean(data.active && data.jobs[data.active].status === 'cancelling' && !data.queue.length);
    $('#activityBadge').className = `badge ${data.active ? 'busy' : 'ok'}`;
    $('.activity').classList.toggle('running', Boolean(data.active));
    $('#runningCount').textContent = (data.active ? 1 : 0) + data.queue.length;
    let estimateJob = data.active ? data.jobs[data.active] : null;
    if (data.active) {
      const job = data.jobs[data.active];
      $('#activityTitle').textContent = `${names[data.active]} · ${job.repository?.split(':').at(-1) || 'Ziel wird geprüft'} · ${job.status === 'cancelling' ? 'Wird abgebrochen …' : data.phase === 'checking' ? 'Quelle wird geprüft' : 'Backup läuft'}`;
      $('#activityDescription').textContent = job.progress ? `Messwert: ${date(job.progress.updatedAt)} · Upload zählt die vom Client gemeldeten Daten; Komprimierung und Deduplizierung beeinflussen den Netzverkehr.` : 'Warte auf Messwerte des Clients. Ältere Clients liefern eventuell erst am Ende Werte; das Live-Protokoll bleibt verfügbar.';
      for (const [label, value] of [['Laufzeit', duration(job.startedAt)], ['Verarbeitet', formatBytes(job.progress?.processedBytes)], ['Upload (Client)', formatBytes(job.progress?.uploadedBytes)], ['Ø Verarbeitung', job.progress?.processingBytesPerSecond != null ? formatBytes(job.progress.processingBytesPerSecond) + '/s' : '—']]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#activityMeta').append(item); }


    } else {
      $('#activityTitle').textContent = 'Gerade läuft kein Backup';
      const latest = Object.entries(data.jobs).filter(([, job]) => job.endedAt).sort((a, b) => b[1].endedAt.localeCompare(a[1].endedAt))[0];
      if (latest?.[1].status === 'success') estimateJob = latest[1];
      if (latest && ['failed', 'interrupted'].includes(latest[1].status)) { $('#activityBadge').textContent = 'Letzter Lauf mit Fehler'; $('#activityBadge').className = 'badge bad'; }
      $('#activityDescription').textContent = latest ? `Letzter Lauf: ${names[latest[0]]} · ${statuses[latest[1].status]} · ${date(latest[1].endedAt)}${latest[1].error ? ' · ' + latest[1].error : ''}` : 'Starte unten eine Sicherung oder hinterlege einen Sicherungsplan an der Quelle.';

    }
    $('#activityTitle').title = $('#activityTitle').textContent;
    $('#activityDescription').title = $('#activityDescription').textContent;
    previousActive = data.active;
    renderEstimate($('#queueInfo'), estimateJob, data.queue.length ? `Danach: ${data.queue.map(id => names[id]).join(' → ')}` : estimateJob ? '' : 'Keine weiteren Aufträge in der Warteschlange.');
    lastHealth = data.health || {};
    for (const row of document.querySelectorAll('[data-folder]')) {
      const job = data.jobs[row.dataset.folder] || { status: 'idle' }, state = row.querySelector('.job-state');
      const folder = folderData.find(item => item.id === row.dataset.folder); renderFolderState(state, folder, job, lastHealth[row.dataset.folder]);
      const cancel = row.querySelector('[data-cancel]'); if (cancel) { cancel.hidden = !['running','queued','cancelling'].includes(job.status); cancel.disabled = job.status === 'cancelling'; }
      const next = row.querySelector('.next-run'); if (next) next.textContent = lastHealth[row.dataset.folder]?.nextAt ? date(lastHealth[row.dataset.folder].nextAt) : 'Nur manuell';
      renderSourceHealth(row.querySelector('.source-health'), folder, job, lastHealth[row.dataset.folder]);
      const start = row.querySelector('[data-start]'); start.hidden = ['running','queued','cancelling'].includes(job.status); start.disabled = start.dataset.available !== 'true' || ['running', 'queued', 'cancelling'].includes(job.status);
    }

    if (!data.active) {
      const warnings = Object.values(lastHealth).filter(item => item.missed || item.stale).length;
      if (warnings) { $('#activityBadge').textContent = `${warnings} Hinweis${warnings > 1 ? 'e' : ''}`; $('#activityBadge').className = 'badge busy'; }
    }
    if (data.maintenance && !data.active) { $('#activityTitle').textContent = 'Wartung / Update'; $('#activityBadge').textContent = 'Pausiert'; $('#activityBadge').className = 'badge busy'; $('#activityDescription').textContent = 'Neue Backups sind während des Updates gesperrt.'; }
    controls?.activity(data); strategyUI?.activity(data);
    if (['queued','running','cancelling'].includes(data.drive?.status)) {
      $('#runningCount').textContent = (data.active ? 1 : 0) + data.queue.length + 1;
      $('#cancelAll').hidden = false; $('#cancelAll').disabled = false;
      if (!data.active) { drive?.renderActivity($('#queueInfo'),data.drive); $('.activity').classList.toggle('running',data.drive.status!=='queued'); $('#activityTitle').textContent = 'Google Drive · ' + (data.drive.source || 'Ausgewählte Quellen'); $('#activityDescription').textContent = data.drive.message; $('#activityBadge').textContent = data.drive.status === 'queued' ? 'Drive wartet' : data.drive.status === 'cancelling' ? 'Abbruch läuft' : 'Drive läuft'; $('#activityBadge').className = 'badge busy'; }
    }
    $('#activityTitle').title = $('#activityTitle').textContent; $('#activityDescription').title = $('#activityDescription').textContent;
    if (data.notification && !$('#notifyDetails').open) $('#notificationResult').textContent = `${data.notification.message} (${date(data.notification.at)})`;

  } catch (e) { if (authenticated) { $('#activityBadge').textContent = 'Verbindung unterbrochen'; $('#activityBadge').className = 'badge bad'; notice(e.message, true); } }
  finally { activityPolling = false; }
}
const timezones = new Set(['Europe/Berlin', 'UTC', ...((Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) || ['Europe/London','America/New_York'])]);
$('#timezones').replaceChildren();
for (const zone of timezones) { const option = element('option'); option.value = option.textContent = zone; $('#timezones').append(option); }
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeContext));

installSourceHelp($('#sourceForm'));
$('#sourceForm').elements.expectedSource.parentElement.prepend($('#probeSource'));
function resetSource() {
  $('#sourceSchedule').hidden=false; sourceEditing = null; clearFieldErrors($('#sourceForm')); $('#sourceForm').reset(); $('#sourceForm').elements.id.readOnly = false; $('#sourceFormTitle').textContent = 'Quelle hinzufügen'; $('#sourceResult').textContent = ''; $('#sourceProblem').hidden = true; fillSourcePlan($('#sourceForm').elements.target.value === 'gdrive' ? savedConfig.gdrive.schedule : { days: [], time: '' }); renderSourceTargetHint();
}
function backupTargets() {
  return [{ id: 'primary', name: savedConfig?.repository?.split(':').at(-1) || 'Datastore 1' }, ...(savedConfig?.secondaryDatastore ? [{ id: 'secondary', name: savedConfig.secondaryDatastore + (savedConfig.secondaryPBS ? ' · ' + savedConfig.secondaryPBS.server : '') }] : []), ...(savedConfig?.additionalDatastores || []).map(item=>({id:item.id,name:item.datastore}))];
}
function renderSources() {
  const selected = $('#sourceForm').elements.target.value || 'primary';
  $('#sourceForm').elements.target.replaceChildren(...[...backupTargets().filter(target => target.id !== 'primary' || savedConfig.repository), ...(savedConfig.gdrive?.remote ? [{id:'gdrive',name:'Google Drive · '+savedConfig.gdrive.remote}] : [])].map(target => { const option = element('option', target.name); option.value = target.id; return option; }));
  $('#sourceForm').elements.target.value = selected;
  if (!$('#sourceForm').elements.target.value) $('#sourceForm').elements.target.selectedIndex = 0;
  renderDiscovered();
  $('#sourceList').replaceChildren();
  const query = $('#sourceSearch').value.trim().toLocaleLowerCase('de'), filter = $('#sourceStatusFilter').value;
  const sources = savedConfig.sources.filter(source => {
    const folder=folderData.find(item=>item.id===source.id);
    return (!$('#sourceSearch').dataset.exactId || source.id === $('#sourceSearch').dataset.exactId) && [source.name,source.path,source.expectedSource,folder?.mount?.source].join(' ').toLocaleLowerCase('de').includes(query) && (filter==='all'||filter==='available'&&folder?.ok||filter==='unavailable'&&!folder?.ok&&!folder?.checking);
  });
  $('#sourceListCount').textContent = `${sources.length} von ${savedConfig.sources.length} Quellen`;
  for (const source of sources) {
    const row = element('tr', undefined, 'source-editor-row'), info = element('td'); row.dataset.sourceId=source.id;
    const folder=folderData.find(item=>item.id===source.id)||{};
    if(source.selection)info.append(element('small',source.selection.length+' ausgewählte Dateien','hint'));
    info.append(element('strong', source.name), element('code', source.path), element('small', source.expectedSource || 'Mount-Identität noch nicht festgelegt', 'hint'));

    const detected = folderData.find(item => item.id === source.id)?.mount?.source; if (detected) info.append(element('small', `Aktuell erkannt: ${detected}`, 'hint'));
    const actions = element('td', undefined, 'source-editor-actions');
    const edit = element('button', 'Bearbeiten', 'row-action'); edit.addEventListener('click', () => {
      editSource(source.id);
    });
    const pin = element('button', 'Mount bestätigen', 'row-action'); pin.addEventListener('click', async () => {
      pin.disabled = true;
      try { const check = await api('/api/sources/probe', { path: source.path }); if (!check.ok) throw new Error(check.error); await api('/api/sources', { sources: savedConfig.sources.map(item => item.id === source.id ? { ...item, expectedSource: check.mount.source } : item) }); loaded = false; await refresh(); renderSources(); $('#sourceResult').textContent = `Bestätigt: ${check.mount.source}`; }
      catch (e) { $('#sourceResult').textContent = e.message; } finally { pin.disabled = false; }
    });
    const remove = element('button', 'Abmelden', 'row-action'); remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { await api('/api/sources', { sources: savedConfig.sources.filter(item => item.id !== source.id) }); loaded = false; await refresh(); renderSources(); if (sourceEditing === source.id) resetSource(); $('#sourceResult').textContent = 'Quelle aus der App entfernt. Dateien und Sicherungen bleiben erhalten.'; }
      catch (e) { $('#sourceResult').textContent = e.message; remove.disabled = false; }
    });
    const mount=element('td');mount.append(element('span',folder.ok?'Eingebunden':folder.checking?'Wird geprüft':'Nicht verfügbar','badge '+(folder.ok?'ok':folder.checking?'busy':'bad')));if(folder.error)mount.append(element('small',folder.error,'row-error'));
    const size=element('td',folder.size?.bytes!=null?new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(folder.size.bytes/1024**3)+' GiB':'Noch nicht ermittelt');
    const target=element('td');target.append(element('span',source.partitioned ? 'Aufgeteilt · '+savedConfig.sources.filter(item=>item.parentId===source.id).length+' Aufträge' : source.target === 'gdrive' ? 'Google Drive' : backupTargets().find(target=>target.id===(source.target||'primary'))?.name||'PBS fehlt'));if(source.target !== 'gdrive' && savedConfig.gdrive.sources.includes(source.id))target.append(element('small','+ Google Drive','hint'));
    const plan=element('td',scheduleText(source.target === 'gdrive' ? savedConfig.gdrive.schedule : savedConfig.schedules[source.id]));
    const split=element('button',source.partitioned?'Aufteilung bearbeiten':'Dateien & Ordner zuordnen','row-action');split.type='button';split.onclick=()=>partitionTools.open(source.id);
    actions.append(edit,pin,...(!source.parentId&&source.target!=='gdrive'?[split]:[]),remove);row.append(info,mount,size,target,plan,actions);$('#sourceList').append(row);
  }
}
function renderSourceTargetHint() {
  let hint = $('#sourceTargetHint');
  if (!hint) { hint = element('p', '', 'hint'); hint.id = 'sourceTargetHint'; $('#sourceSchedule').before(hint); }
  hint.hidden = $('#sourceForm').elements.target.value !== 'gdrive';
  hint.textContent = 'Google Drive: Modus und Zielordner aus „Ziele“ werden verwendet. Der folgende Zeitplan gilt gemeinsam für alle Google-Drive-Quellen. Es wird kein PBS-Auftrag für diese Quelle erstellt.';
}
$('#sourceForm').elements.target.addEventListener('change', () => {
  const source = savedConfig.sources.find(item => item.id === sourceEditing);
  fillSourcePlan($('#sourceForm').elements.target.value === 'gdrive' ? savedConfig.gdrive.schedule : savedConfig.schedules[source?.id] || {days:[],time:''});
  renderSourceTargetHint();
});
$('#sourceSearch').addEventListener('input', () => { delete $('#sourceSearch').dataset.exactId; renderSources(); });
$('#sourceStatusFilter').addEventListener('change', renderSources);
$('#resetSource').addEventListener('click', resetSource);
$('#probeSource').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { const check = await api('/api/sources/probe', { path: $('#sourceForm').elements.path.value }); if (!check.ok) throw new Error(check.error); $('#sourceForm').elements.expectedSource.value = check.mount.source; $('#sourceResult').textContent = `Erkannt: ${check.mount.source} · zum Bestätigen Quelle speichern.`; }
  catch (e) { $('#sourceResult').textContent = e.message; } finally { button.disabled = false; }
});
$('#sourceForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const source = {...savedConfig.sources.find(item=>item.id===sourceEditing)}; for (const key of ['id','name','path','expectedSource','target']) source[key] = form.elements[key].value.trim();
    const errors = validateSourceForm(source, savedConfig.sources, sourceEditing);
    const chosenDays = [...$('#sourceDays').querySelectorAll('button[aria-pressed="true"]')].map(button => Number(button.dataset.day));
    if (!['manual','monthly'].includes(form.elements.planMode.value) && !chosenDays.length) errors.planMode = 'Mindestens einen Wochentag wählen.';
    if (form.elements.planMode.value !== 'manual' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.elements.planTime.value)) errors.planTime = 'Eine gültige Uhrzeit wählen.'; showFieldErrors(form, errors);
    if (Object.keys(errors).length) throw new Error('Bitte die markierten Quellenfelder korrigieren.');
    const sources = sourceEditing ? savedConfig.sources.map(item => item.id === sourceEditing ? source : item) : [...savedConfig.sources, source];
    const monthly = form.elements.planMode.value === 'monthly';
    const schedule = { days: ['manual','monthly'].includes(form.elements.planMode.value) ? [] : chosenDays, time: form.elements.planMode.value === 'manual' ? '' : form.elements.planTime.value, ...(monthly ? { monthDay: form.elements.monthDay.value === 'last' ? 'last' : Number(form.elements.monthDay.value) } : {}) };
    await api('/api/sources', { sources, schedule: { id: source.id, value: schedule } }); loaded = false; await refresh(); renderSources(); if (detailId) editSource(source.id, true); else resetSource(); $('#sourceResult').textContent = 'Quelle und Sicherungsplan gespeichert.';
  } catch (e) { const field = serverField(e); if (field) showFieldErrors(form, { [field]: e.message }); $('#sourceResult').textContent = e.message; } finally { button.disabled = false; }
});
async function openHistory(id) {
  $('#historyTitle').textContent = `Verlauf · ${names[id]}`; $('#historySummary').textContent = 'Wird geladen …'; $('#historyRows').replaceChildren(); showContext('historyDialog', id);
  try {
    const data = await api(`/api/history/${id}`), folder = folderData.find(item => item.id === id), health = lastHealth[id] || folder.health;
    $('#historySummary').textContent = `${folder.path} · Ziel: ${folder.targetRepository || 'Noch nicht konfiguriert'} · ${nextText(health)} (${activeTimezone})${health?.message ? ' · ' + health.message : ''}`;
    controls?.comparison(data.comparison);
    if (!data.entries.length) { const row = element('tr'), cell = element('td', 'Noch keine abgeschlossenen App-Läufe.'); cell.colSpan = 7; row.append(cell); $('#historyRows').append(row); }
    for (const entry of data.entries) {
      const row = element('tr'); row.append(element('td', entry.startedAt ? date(entry.startedAt) : 'Unbekannt'), element('td', statuses[entry.status]), element('td', entry.durationSeconds === null ? '—' : `${Math.floor(entry.durationSeconds / 60)} min ${entry.durationSeconds % 60} s`), element('td', formatBytes(entry.progress?.processedBytes)), element('td', formatBytes(entry.progress?.uploadedBytes)), element('td', entry.source === 'schedule' ? 'Zeitplan' : entry.source === 'manual' ? 'Manuell' : 'Altbestand'));
      const cell = element('td'), button = element('button','Öffnen','row-action'); button.addEventListener('click', () => openLog(id, entry.runId)); cell.append(button); row.append(cell); row.title = [entry.repository && 'Ziel: ' + entry.repository, entry.error].filter(Boolean).join(' · '); const target = element('small', entry.repository || 'Ziel unbekannt', 'history-target'); row.firstElementChild.append(target); $('#historyRows').append(row);
    }
  } catch (e) { $('#historySummary').textContent = e.message; }
}
async function openPBS(target = 'primary') {
  $('#pbsFilter').replaceChildren(); const all = element('option','Alle Gruppen'); all.value = ''; $('#pbsFilter').append(all);
  for (const [id,name] of Object.entries(names)) { const option = element('option',name); option.value = id; $('#pbsFilter').append(option); }
  $('#pbsTarget').replaceChildren(...backupTargets().map(target => { const option = element('option', target.name); option.value = target.id; return option; }));
  if([...$('#pbsTarget').options].some(item=>item.value===target))$('#pbsTarget').value=target;
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
$('#pbsTarget').addEventListener('change', () => { history.replaceState(null,'','#pbsDialog/'+$('#pbsTarget').value);void loadPBS(); });
$('#pbsFilter').addEventListener('change', renderPBS);
function renderPBS() {
  if (!pbsData) return;
  $('#pbsRows').replaceChildren(); const filter = $('#pbsFilter').value;
  const snapshots = (pbsData.snapshots || []).filter(snapshot => !filter || [filter,`qnap-${filter}`].includes(snapshot.id));
  $('#pbsSummary').textContent = `${pbsData.checkedAt ? 'Stand: ' + date(pbsData.checkedAt) : 'Noch nicht abgerufen – „Vom PBS abrufen“ wählen.'} · ${snapshots.length} Snapshots${pbsData.error ? ' · ' + pbsData.error + ' (ggf. alter Bestand)' : ''}${snapshots.length > 200 ? ' · die neuesten 200 werden angezeigt' : ''}${pbsData.count > 5000 ? ' · Abruf auf 5000 Einträge begrenzt' : ''}`;
  for (const snapshot of snapshots.slice(0,200)) { const row = element('tr'), size = snapshot.size === null ? '—' : `${(snapshot.size / 1024 ** 3).toFixed(2)} GiB`; row.append(element('td', snapshot.group + (snapshot.protected ? ' 🔒' : '')), element('td',date(snapshot.time)), element('td',size), element('td',snapshot.files.join(', ') || '—')); $('#pbsRows').append(row); }
}
function fillNotifications(settings) {
  const form = $('#notifyForm'); form.elements.enabled.checked = settings.enabled; form.elements.success.checked = settings.success || false;
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
  return { enabled, success: form.elements.success.checked, url: topic ? `${server}/${encodeURIComponent(topic)}` : '', token: form.elements.token.value.trim() };
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

function paintSourcePlan() {
  const form = $('#sourceForm'), manual = form.elements.planMode.value === 'manual', monthly = form.elements.planMode.value === 'monthly';
  $('#sourceDays').hidden = monthly; $('#sourceMonthLabel').hidden = !monthly; $('#sourceMonthHint').hidden = !monthly; form.elements.monthDay.disabled = !monthly;
  form.elements.planTime.disabled = manual;
  for (const button of $('#sourceDays').children) button.disabled = manual;
}
function fillSourcePlan(schedule) {
  const form = $('#sourceForm'), matched = Object.entries(presets).find(([, days]) => days.join(',') === schedule.days.join(','));
  form.elements.planMode.value = schedule.monthDay !== undefined ? 'monthly' : matched ? matched[0] : schedule.days.length === 1 ? 'weekly' : 'custom'; form.elements.planTime.value = schedule.time || '02:00';
  form.elements.monthDay.replaceChildren(...Array.from({ length: 31 }, (_, index) => { const option = element('option', (index + 1) + '.'); option.value = String(index + 1); return option; }), Object.assign(element('option', 'Letzter Tag'), { value: 'last' }));
  form.elements.monthDay.value = String(schedule.monthDay ?? 1);
  $('#sourceDays').replaceChildren();
  for (let day = 1; day <= 7; day++) { const button = element('button', dayNames[day - 1]); button.type = 'button'; button.dataset.day = day; button.setAttribute('aria-label', 'Sicherung ' + dayNames[day - 1]); button.setAttribute('aria-pressed', String(schedule.days.includes(day))); button.addEventListener('click', () => { button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')); const count = [...$('#sourceDays').children].filter(item => item.getAttribute('aria-pressed') === 'true').length; form.elements.planMode.value = count === 1 ? 'weekly' : 'custom'; }); $('#sourceDays').append(button); }
  $('#sourceTimezone').textContent = `Zeitzone: ${activeTimezone} · gilt für alle gewählten Tage.`; paintSourcePlan();
}
$('#sourceForm').elements.planMode.addEventListener('change', event => {
  const mode = event.target.value, current = [...$('#sourceDays').children].filter(button => button.getAttribute('aria-pressed') === 'true').map(button => Number(button.dataset.day));
  const days = presets[mode] || (mode === 'weekly' ? [current[0] || 1] : current.length ? current : [1,3,5]);
  for (const button of $('#sourceDays').children) button.setAttribute('aria-pressed', String(days.includes(Number(button.dataset.day)))); paintSourcePlan();
});
function editSource(id, inline = false) {
  const source = savedConfig.sources.find(item => item.id === id); if (!source) return;
  renderSources(); sourceEditing = id; const form = $('#sourceForm'); clearFieldErrors(form);
  for (const key of ['id','name','path','expectedSource']) form.elements[key].value = source[key];
  $('#sourceSchedule').hidden=Boolean(source.partitioned); form.elements.target.value = source.target || 'primary'; form.elements.id.readOnly = true;
  $('#sourceFormTitle').textContent = `Quelle bearbeiten · ${source.name}`; $('#sourceResult').textContent = '';
  fillSourcePlan(source.target === 'gdrive' ? savedConfig.gdrive.schedule : savedConfig.schedules[id]); renderSourceTargetHint(); renderSourceProblem(id);
  if (inline) showContext('sourceForm', id); else form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
fillSourcePlan({ days: [], time: '' });

assistant = installAssistant({ api, getConfig: () => savedConfig, refresh, openSource: id => { location.hash = 'sourcesDialog/' + id + '/edit'; } });

$('#configForm').elements.secondaryOwnServer.addEventListener('change', event => { $('#secondaryFields').hidden = !event.target.checked; });

function issueFor(folder, job = folder?.job, health = folder?.health) { return folder ? sourceProblem(folder, job, health, lastTargets.find(target => target.id === (folder.target || 'primary')), latestConnection(job, lastConnections[folder.target || 'primary'], lastCapacities[folder.target || 'primary'], folder.pbsCheckAfter)) : null; }
async function runSource(id) { try { await api(`/api/backup/${id}`, {}); notice(`${names[id]} zur Sicherung vorgemerkt.`); await refresh(); } catch (e) { notice(e.message, true); } }
function openProblem(folder, issue) {
  if (issue.view === 'restore') void restore.open(folder.id);
  else if (issue.view === 'connection') { void (async () => { try { notice('PBS-Verbindung wird geprüft …'); const result = await api('/api/connection', { target: folder.target || 'primary' }); await refresh(); notice(result.message, !result.ok); } catch (e) { notice(e.message, true); } })(); }
  else if (issue.view === 'source') editSource(folder.id, true);
  else if (issue.view === 'log') void openLog(folder.id);
  else if (issue.view === 'backup') void runSource(folder.id);
  else { $('#pbsSettings').open = true; location.hash = 'targets'; setTimeout(() => $('#configForm').elements[folder.target === 'secondary' && savedConfig.secondaryPBS ? 'secondaryServer' : 'server'].focus(), 0); }
}
function renderSourceHealth(cell, folder, job, health) {
  if (!folder) return;
  const target = folder.target || 'primary', status = sourceHealth(folder, job, health, lastTargets.find(item => item.id === target), lastConnections[target], lastCapacities[target]);
  const badge = element('button', status.label, `badge health-badge ${status.tone}`); badge.type = 'button'; badge.setAttribute('aria-label', `${folder.name}: ${status.label}`);
  badge.title = `${status.message}${folder.checkedAt ? ' · Mount-Stand: ' + date(folder.checkedAt) : ''}${status.checkedAt ? ' · PBS-Stand: ' + date(status.checkedAt) : ''} · ${status.action}`;
  badge.addEventListener('click', () => openProblem(folder, status));
  cell.replaceChildren(element('span', date(job.lastSuccess)), badge);
}
function renderFolderState(cell, folder, job, health) {
  renderJob(cell, job, health); if (job.verification) { const v = job.verification; const hint = element('small', v.status === 'running' ? 'Snapshot wird geprüft …' : v.status === 'success' ? 'Snapshot + Archiv bestätigt' : v.status === 'cancelled' ? 'Zielprüfung abgebrochen' : 'Snapshot nicht bestätigt', 'hint'); hint.title = (v.message || '') + (v.checkedAt ? ' · ' + date(v.checkedAt) : ''); cell.append(hint); } const issue = issueFor(folder, job, health); if (!issue) return;
  if (['mount','target'].includes(issue.kind) && !['running','queued','cancelling'].includes(job.status)) { const badge = cell.querySelector('.badge'); badge.textContent = 'Handlungsbedarf'; badge.className = 'badge bad'; }
  cell.querySelector('.row-error')?.remove(); const text = element('small', issue.message, 'row-error problem-message'); text.title = issue.message + ' ' + issue.help;
  const button = element('button', issue.action, 'row-action problem-action'); button.type = 'button'; button.addEventListener('click', () => openProblem(folder, issue)); cell.append(text, button);
}
function renderSourceProblem(id) {
  const folder = folderData.find(item => item.id === id), issue = issueFor(folder), box = $('#sourceProblem'); box.hidden = !issue; box.replaceChildren(); if (!issue) return;
  box.append(element('strong', issue.message), element('p', issue.help, 'hint'));
  if (issue.kind === 'mount') { box.append(element('code', 'Erkannt: ' + (folder.mount?.source || 'kein Netzwerk-Mount')), element('code', 'Erwartet: ' + (folder.expectedSource || 'noch nicht festgelegt'))); }
  else { const button = element('button', issue.action, 'secondary'); button.type = 'button'; button.addEventListener('click', () => openProblem(folder, issue)); box.append(button); }
}
partitionTools = installPartitions({api,element,refresh});
timeline = installTimeline({ element, openSource: id => editSource(id, true) });

for (const details of document.querySelectorAll('#targets>.target-accordion, #overviewPlan')) {
  try { details.open = localStorage.getItem('backup-target-' + details.id) === 'open'; } catch {}
  details.addEventListener('toggle', () => { try { localStorage.setItem('backup-target-' + details.id, details.open ? 'open' : 'closed'); } catch {} });
}
strategyUI = installStrategy({api,element,date,scheduleText,notice});
dashboard = installDashboard({ element, date, openSource: source => { $('#sourceSearch').value = source.name; $('#sourceSearch').dataset.exactId=source.id; location.hash = 'sourcesDialog'; renderSources(); }, resolveProblem: (source, issue) => { if (issue.view === 'source') location.hash = 'sourcesDialog/' + source.id + '/edit'; else if (issue.view === 'log') void openLog(source.id); else if (issue.view === 'backup') location.hash = 'jobs'; else { $('#pbsSettings').open=true;location.hash='targets'; } } });
drive = installDrive({ api, element, notice, scheduleText, date });
operations = installOperations({api,element,refresh,date});

controls = installControls({ api, element, refresh, refreshActivity, notice, date, getNames: () => names, onRestored: () => { for (const id of ['configForm','preferencesForm','authForm','notifyForm']) formState.clean(id, formState.capture(id)); lastMainSnapshot = lastPreferencesSnapshot = lastNotifySnapshot = null; loaded = false; } });

restore = installRestore({ api, element, date, showContext });

installMountTools({ getConfig: () => savedConfig, element });

$('#sourceOverviewDetails').open = true;
$('#sourceOverviewDetails>summary').addEventListener('click', event => event.preventDefault());

installLogbook({api,element,date,isAuthenticated:()=>authenticated});

function renderAdditionalTargets(config) {
 const root=$('#additionalTargets'),snapshot=JSON.stringify([config.repository,config.secondaryDatastore,config.secondaryPBS,config.additionalDatastores,config.namespace,config.sources.map(item=>[item.id,item.target]),lastConnections]);
 if(snapshot===additionalTargetsSnapshot || root.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;
 additionalTargetsSnapshot=snapshot;root.replaceChildren();
 const stores=[...(config.repository?[{id:'primary',datastore:config.repository.split(':').at(-1),repository:config.repository,namespace:config.namespace}]:[]),...(config.secondaryDatastore?[{id:'secondary',datastore:config.secondaryDatastore,repository:config.secondaryPBS?config.secondaryPBS.authId+'@'+config.secondaryPBS.server+':'+config.secondaryDatastore:config.repository.slice(0,config.repository.lastIndexOf(':')+1)+config.secondaryDatastore,namespace:config.secondaryPBS?.namespace??config.namespace}]:[]),...(config.additionalDatastores||[]).map(item=>({...item,repository:config.repository.slice(0,config.repository.lastIndexOf(':')+1)+item.datastore,namespace:config.namespace}))];
 const heading=element('div',undefined,'panel-title'),add=element('a','+ Datastore hinzufügen','secondary');add.href='#assistant/pbs';heading.append(element('h3','Datastores · '+stores.length),add);root.append(heading);
 if(!stores.length){root.append(element('p','Noch kein Datastore eingerichtet. Über den Assistenten hinzufügen.','hint'));return;}
 const table=element('table'),head=element('thead'),columns=element('tr');for(const name of ['Datastore','PBS / Namespace','Quellen','Status','Aktionen'])columns.append(element('th',name));head.append(columns);table.append(head);const body=element('tbody');
 for(const entry of stores){
  const row=element('tr');row.dataset.datastore=entry.id;
  const cell=element('td'),input=element('input');input.value=entry.datastore;input.setAttribute('aria-label','Datastore '+entry.datastore);cell.append(input);
  const server=element('td');server.append(element('code',entry.repository.slice(entry.repository.lastIndexOf('@')+1,entry.repository.lastIndexOf(':'))),element('small',entry.namespace?'Namespace: '+entry.namespace:'Standard-Namespace','hint'));
  const related=config.sources.filter(item=>!item.partitioned&&(item.target||'primary')===entry.id),status=lastConnections[entry.id],badge=element('span',status?status.ok?'Erreichbar':'Prüfung fehlgeschlagen':'Ungeprüft','badge '+(status?status.ok?'ok':'bad':''));badge.title=status?.message||'Verbindung noch nicht geprüft.';
  const state=element('td');state.append(badge);
  const actions=element('td'),buttons=element('div',undefined,'datastore-actions');
  const save=element('button','Änderung speichern','row-action');save.type='button';save.onclick=async()=>{
   const name=input.value.trim();if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(name)){notice('Gültigen Datastore-Namen angeben.',true);return;}save.disabled=true;
   try{const changes=entry.id==='primary'?{repository:savedConfig.repository.slice(0,savedConfig.repository.lastIndexOf(':')+1)+name}:entry.id==='secondary'?{secondaryDatastore:name}:{additionalDatastores:savedConfig.additionalDatastores.map(item=>item.id===entry.id?{...item,datastore:name}:item)};await api('/api/targets',changes);loaded=false;await refresh();notice('Datastore gespeichert.');}catch(error){notice(error.message,true);}finally{save.disabled=false;}
  };
  const check=element('button','Prüfen','row-action');check.type='button';check.onclick=async()=>{check.disabled=true;try{const result=await api('/api/connection',{target:entry.id});await refresh();notice(entry.datastore+': '+result.message,!result.ok);}catch(error){notice(error.message,true);}finally{check.disabled=false;}};
  const inventory=element('a','Bestand','row-action');inventory.href='#pbsDialog/'+entry.id;
  const remove=element('button','Entfernen','row-action');remove.type='button';const confirmation=element('div',undefined,'datastore-confirm');confirmation.hidden=true;confirmation.append(element('small','Nur App-Ziel entfernen? PBS-Datastore und Sicherungen bleiben erhalten.','hint'));const yes=element('button','Entfernen bestätigen','row-action'),no=element('button','Behalten','row-action');yes.type=no.type='button';no.onclick=()=>{confirmation.hidden=true;};yes.onclick=async()=>{yes.disabled=true;try{await api('/api/targets/remove',{target:entry.id});loaded=false;await refresh();notice('App-Ziel entfernt. PBS-Datastore und Sicherungen bleiben erhalten.');}catch(error){notice(error.message,true);}finally{yes.disabled=false;}};confirmation.append(yes,no);remove.onclick=()=>{confirmation.hidden=!confirmation.hidden;};
  buttons.append(save,check,inventory,remove);actions.append(buttons,confirmation);row.append(cell,server,element('td',String(related.length)),state,actions);body.append(row);
 }
 table.append(body);const wrap=element('div',undefined,'datastore-table');wrap.append(table);root.append(wrap,element('p','Namen ändern aktualisiert nur die App-Zuordnung. Neue Datastores über den Assistenten anlegen oder verbinden. Zusätzliche Datastores auf PBS 1 teilen dessen Zugang und Fingerprint.','hint'));
}
