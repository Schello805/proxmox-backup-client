'use strict';
const $ = selector => document.querySelector(selector);
const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik' };
const statuses = { idle: 'Noch kein Lauf', queued: 'Wartet', running: 'Läuft', success: 'Erfolgreich', failed: 'Fehler', interrupted: 'Unterbrochen' };
let loaded = false, polling = false, logFolder = null, noticeTimer, authenticated = false, activityPolling = false, previousActive = null, authEpoch = 0;
const date = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value)) : 'Noch kein Erfolg';
function notice(message, error = false) {
  $('#notice').textContent = message; $('#notice').classList.toggle('error', error); $('#notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('#notice').hidden = true, 12000);
}
async function api(url, data) {
  const res = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qnap-dashboard' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Bitte anmelden.'); }
  if (!res.ok) throw new Error(result.error || 'Anfrage fehlgeschlagen.'); return result;
}
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const presets = { manual: [], daily: [1,2,3,4,5,6,7], weekdays: [1,2,3,4,5], weekend: [6,7] };
const scheduleControls = new Map();
function scheduleText(schedule) {
  if (!schedule.days.length) return 'Nur manuell';
  const days = schedule.days.join(',');
  const label = days === '1,2,3,4,5,6,7' ? 'Täglich' : days === '1,2,3,4,5' ? 'Mo–Fr' : days === '6,7' ? 'Sa–So' : schedule.days.map(day => dayNames[day - 1]).join(', ');
  return `${label} · ${schedule.time}`;
}
function buildSchedule(id, name, schedule) {
  const row = element('div', undefined, 'schedule-row'), title = element('strong', name);
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
  const form = $('#configForm');
  const at = config.repository.lastIndexOf('@'), colon = config.repository.lastIndexOf(':');
  form.elements.authId.value = at > 0 ? config.repository.slice(0, at) : '';
  form.elements.server.value = at > 0 && colon > at ? config.repository.slice(at + 1, colon) : '';
  form.elements.datastore.value = colon > at ? config.repository.slice(colon + 1) : 'pbs1';
  for (const key of ['fingerprint', 'namespace']) form.elements[key].value = config[key];
  $('#repositoryPreview').textContent = config.repository || 'Noch nicht gespeichert';
  form.elements.password.value = '';
  $('#passwordHint').textContent = config.hasPassword ? 'PBS-Passwort gespeichert · leer lassen zum Beibehalten.' : 'PBS-Passwort noch nicht hinterlegt.';
  $('#schedules').replaceChildren(); scheduleControls.clear();
  for (const [id, name] of Object.entries(names)) buildSchedule(id, name, config.schedules[id]);
}
async function refresh() {
  if (polling) return; polling = true; const epoch = authEpoch;
  try {
    const data = await api('/api/status');
    if (epoch !== authEpoch) return;
    authenticated = true; document.body.classList.remove('locked'); if ($('#loginDialog').open) $('#loginDialog').close();
    $('#updated').textContent = `Aktualisiert ${new Date().toLocaleTimeString('de-DE')} · live`;
    $('#mountCount').textContent = `${data.folders.filter(f => f.ok).length} / 5`;
    $('#runningCount').textContent = data.folders.filter(f => ['running', 'queued'].includes(f.job.status)).length;
    $('#successCount').textContent = `${data.folders.filter(f => f.job.status === 'success').length} / 5`;
    $('#targetStatus').textContent = data.connection ? (data.connection.ok ? 'Verbunden' : 'Prüfung fehlgeschlagen') : 'Ungeprüft';
    $('#targetName').textContent = data.config.repository || 'Noch kein Repository'; $('#flowTarget').textContent = data.config.repository || 'Ziel noch nicht konfiguriert';
    $('#folders').replaceChildren();
    for (const folder of data.folders) {
      const row = element('tr'); row.dataset.folder = folder.id; const source = element('td'); source.append(element('strong', names[folder.id]), element('code', folder.path)); row.append(source);
      const mount = element('td'), badge = element('span', folder.ok ? '● Eingebunden' : '● Nicht verfügbar', `badge ${folder.ok ? 'ok' : 'bad'}`); badge.title = folder.ok ? `${folder.mount.source} → ${folder.mount.target} (${folder.mount.type})` : folder.error; mount.append(badge); row.append(mount);
      const plan = element('td', scheduleText(folder.schedule)); plan.title = plan.textContent;
      row.append(plan, element('td', date(folder.job.lastSuccess)));
      const state = element('td'), status = folder.job.status; const statusBadge = element('span', statuses[status] || status, `badge ${status === 'success' ? 'ok' : ['running', 'queued'].includes(status) ? 'busy' : ['failed', 'interrupted'].includes(status) ? 'bad' : ''}`); statusBadge.title = folder.job.error || ''; state.className = 'job-state'; state.append(statusBadge); if (folder.job.error) { const error = element('small', folder.job.error, 'row-error'); error.title = folder.job.error; state.append(error); } row.append(state);
      const actions = element('td'), start = element('button', '↗ Sichern', 'row-action'), logs = element('button', 'Protokoll', 'row-action');
      start.dataset.start = folder.id; start.dataset.available = String(Boolean(folder.ok && data.config.repository && data.config.hasPassword));
      start.disabled = !folder.ok || !data.config.repository || !data.config.hasPassword || ['running', 'queued'].includes(status);
      start.addEventListener('click', async () => { start.disabled = true; try { await api(`/api/backup/${folder.id}`, {}); notice(`${names[folder.id]} zur Sicherung vorgemerkt.`); await refresh(); } catch (e) { notice(e.message, true); start.disabled = false; } });
      logs.addEventListener('click', () => openLog(folder.id)); actions.append(start, logs); row.append(actions); $('#folders').append(row);
    }
    $('#systemInfo').replaceChildren();
    for (const [label, value] of [['Host', data.system.hostname], ['System', data.system.platform], ['Backup Client', data.system.client], ['Zeitpläne', data.system.timezone]]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#systemInfo').append(item); }
    if (!loaded) { fillForm(data.config); loaded = true; }
    if (data.connection) $('#connectionResult').textContent = `${data.connection.message} (${date(data.connection.checkedAt)})`;
    await refreshActivity();
  } catch (e) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; if (authenticated) notice(e.message, true); } finally { polling = false; }
}
async function refreshLog() { try { const data = await api(`/api/logs/${logFolder}`); const pre = $('#logText'), bottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40; pre.textContent = data.log; if (bottom) pre.scrollTop = pre.scrollHeight; } catch (e) { notice(e.message, true); } }
async function openLog(id) { logFolder = id; $('#logTitle').textContent = `Protokoll · ${names[id]}`; $('#logText').textContent = 'Wird geladen …'; $('#logDialog').showModal(); await refreshLog(); }
$('#liveDetails').addEventListener('click', () => { if (previousActive) openLog(previousActive); });
$('#closeLog').addEventListener('click', () => $('#logDialog').close()); $('#logDialog').addEventListener('close', () => logFolder = null);
function navigate(page) { if (!['overview', 'settings', 'guide'].includes(page)) page = 'overview'; document.body.dataset.page = page; document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page); document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === page)); }
document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.page; })); window.addEventListener('hashchange', () => navigate(location.hash.slice(1))); navigate(location.hash.slice(1));
$('#refresh').addEventListener('click', refresh);
$('#configForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!loaded) return notice('Konfiguration zuerst laden.', true);
  const form = event.currentTarget, button = form.querySelector('[type=submit]'), data = { schedules: {} };
  data.repository = `${form.elements.authId.value.trim()}@${form.elements.server.value.trim()}:${form.elements.datastore.value.trim()}`;
  for (const key of ['password', 'fingerprint', 'namespace']) data[key] = form.elements[key].value;
  for (const id of Object.keys(names)) { const control = scheduleControls.get(id); data.schedules[id] = { days: control.mode.value === 'manual' ? [] : control.days, time: control.mode.value === 'manual' ? '' : control.time.value }; }
  button.disabled = true;
  try { await api('/api/config', data); loaded = false; notice('Einstellungen gespeichert.'); $('#connectionResult').textContent = 'Verbindung nach Änderung erneut prüfen.'; await refresh(); const result = await api('/api/connection', {}); $('#connectionResult').textContent = result.message; notice(result.message, !result.ok); } catch (e) { notice(e.message, true); } finally { button.disabled = false; }
});
$('#testConnection').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#connectionResult').textContent = 'Verbindung wird geprüft …';
  try { const data = await api('/api/connection', {}); $('#connectionResult').textContent = data.message; notice(data.message, !data.ok); await refresh(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; }
});
function showLogin() {
  authEpoch++; authenticated = false; loaded = false;
  if ($('#logDialog').open) $('#logDialog').close();
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
    for (const row of document.querySelectorAll('[data-folder]')) {
      const job = data.jobs[row.dataset.folder] || { status: 'idle' }, state = row.querySelector('.job-state');
      state.replaceChildren(element('span', statuses[job.status], `badge ${job.status === 'success' ? 'ok' : ['running', 'queued'].includes(job.status) ? 'busy' : ['failed', 'interrupted'].includes(job.status) ? 'bad' : ''}`));
      if (job.error) { const error = element('small', job.error, 'row-error'); error.title = job.error; state.append(error); }
      row.children[3].textContent = date(job.lastSuccess);
      const start = row.querySelector('[data-start]'); start.disabled = start.dataset.available !== 'true' || ['running', 'queued'].includes(job.status);
    }
    $('#successCount').textContent = `${Object.values(data.jobs).filter(job => job.status === 'success').length} / 5`;
    if (logFolder) await refreshLog();
  } catch (e) { if (authenticated) { $('#activityBadge').textContent = 'Verbindung unterbrochen'; notice(e.message, true); } }
  finally { activityPolling = false; }
}
showLogin(); refresh();
setInterval(() => { if (authenticated) refresh(); }, 15000);
setInterval(refreshActivity, 3000);
