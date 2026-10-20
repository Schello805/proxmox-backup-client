'use strict';
const $ = selector => document.querySelector(selector);
const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik' };
const statuses = { idle: 'Noch kein Lauf', queued: 'Wartet', running: 'Läuft', success: 'Erfolgreich', failed: 'Fehler', interrupted: 'Unterbrochen' };
let loaded = false, polling = false, logFolder = null, noticeTimer;
const date = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value)) : 'Noch kein Erfolg';
function notice(message, error = false) {
  $('#notice').textContent = message; $('#notice').classList.toggle('error', error); $('#notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('#notice').hidden = true, 12000);
}
async function api(url, data) {
  const res = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qnap-dashboard' }, body: JSON.stringify(data) });
  if (res.status === 401) throw new Error('Anmeldung erforderlich. Seite neu laden.');
  const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Anfrage fehlgeschlagen.'); return result;
}
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function fillForm(config) {
  const form = $('#configForm');
  for (const key of ['repository', 'fingerprint', 'namespace']) form.elements[key].value = config[key];
  form.elements.password.value = '';
  $('#passwordHint').textContent = config.hasPassword ? 'Passwort gespeichert. Leer lassen, um es beizubehalten.' : 'Noch kein Passwort gespeichert.';
  $('#schedules').replaceChildren();
  for (const [id, name] of Object.entries(names)) {
    const label = element('label', name), input = element('input'); input.type = 'time'; input.name = `schedule-${id}`; input.value = config.schedules[id]; label.append(input); $('#schedules').append(label);
  }
}
async function refresh() {
  if (polling) return; polling = true;
  try {
    const data = await api('/api/status');
    $('#updated').textContent = `Aktualisiert ${new Date().toLocaleTimeString('de-DE')} · live`;
    $('#mountCount').textContent = `${data.folders.filter(f => f.ok).length} / 5`;
    $('#runningCount').textContent = data.folders.filter(f => ['running', 'queued'].includes(f.job.status)).length;
    $('#successCount').textContent = `${data.folders.filter(f => f.job.status === 'success').length} / 5`;
    $('#targetStatus').textContent = data.connection ? (data.connection.ok ? 'Verbunden' : 'Prüfung fehlgeschlagen') : 'Ungeprüft';
    $('#targetName').textContent = data.config.repository || 'Noch kein Repository'; $('#flowTarget').textContent = data.config.repository || 'Ziel noch nicht konfiguriert';
    $('#folders').replaceChildren();
    for (const folder of data.folders) {
      const row = element('tr'), source = element('td'); source.append(element('strong', names[folder.id]), element('code', folder.path)); row.append(source);
      const mount = element('td'), badge = element('span', folder.ok ? '● Eingebunden' : '● Nicht verfügbar', `badge ${folder.ok ? 'ok' : 'bad'}`); badge.title = folder.ok ? `${folder.mount.source} → ${folder.mount.target} (${folder.mount.type})` : folder.error; mount.append(badge); row.append(mount);
      row.append(element('td', folder.schedule || 'Deaktiviert'), element('td', date(folder.job.lastSuccess)));
      const state = element('td'), status = folder.job.status; const statusBadge = element('span', statuses[status] || status, `badge ${status === 'success' ? 'ok' : ['running', 'queued'].includes(status) ? 'busy' : ['failed', 'interrupted'].includes(status) ? 'bad' : ''}`); statusBadge.title = folder.job.error || ''; state.append(statusBadge); row.append(state);
      const actions = element('td'), start = element('button', '↗ Sichern', 'row-action'), logs = element('button', 'Protokoll', 'row-action');
      start.disabled = !folder.ok || !data.config.repository || !data.config.hasPassword || ['running', 'queued'].includes(status);
      start.addEventListener('click', async () => { start.disabled = true; try { await api(`/api/backup/${folder.id}`, {}); notice(`${names[folder.id]} zur Sicherung vorgemerkt.`); await refresh(); } catch (e) { notice(e.message, true); start.disabled = false; } });
      logs.addEventListener('click', () => openLog(folder.id)); actions.append(start, logs); row.append(actions); $('#folders').append(row);
    }
    $('#systemInfo').replaceChildren();
    for (const [label, value] of [['Host', data.system.hostname], ['System', data.system.platform], ['Backup Client', data.system.client], ['Zeitpläne', data.system.timezone]]) { const item = element('span'); item.append(element('strong', label), document.createTextNode(value)); $('#systemInfo').append(item); }
    if (!loaded) { fillForm(data.config); loaded = true; }
    if (data.connection) $('#connectionResult').textContent = `${data.connection.message} (${date(data.connection.checkedAt)})`;
    if (logFolder) await refreshLog();
  } catch (e) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; notice(e.message, true); } finally { polling = false; }
}
async function refreshLog() { try { const data = await api(`/api/logs/${logFolder}`); const pre = $('#logText'), bottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40; pre.textContent = data.log; if (bottom) pre.scrollTop = pre.scrollHeight; } catch (e) { notice(e.message, true); } }
async function openLog(id) { logFolder = id; $('#logTitle').textContent = `Protokoll · ${names[id]}`; $('#logText').textContent = 'Wird geladen …'; $('#logDialog').showModal(); await refreshLog(); }
$('#closeLog').addEventListener('click', () => $('#logDialog').close()); $('#logDialog').addEventListener('close', () => logFolder = null);
function navigate(page) { if (!['overview', 'settings', 'guide'].includes(page)) page = 'overview'; document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page); document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === page)); }
document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.page; })); window.addEventListener('hashchange', () => navigate(location.hash.slice(1))); navigate(location.hash.slice(1));
$('#refresh').addEventListener('click', refresh);
$('#configForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!loaded) return notice('Konfiguration zuerst laden.', true);
  const form = event.currentTarget, button = form.querySelector('[type=submit]'), data = { schedules: {} };
  for (const key of ['repository', 'password', 'fingerprint', 'namespace']) data[key] = form.elements[key].value;
  for (const id of Object.keys(names)) data.schedules[id] = form.elements[`schedule-${id}`].value;
  button.disabled = true;
  try { await api('/api/config', data); loaded = false; notice('Einstellungen gespeichert.'); $('#connectionResult').textContent = 'Verbindung nach Änderung erneut prüfen.'; await refresh(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; }
});
$('#testConnection').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#connectionResult').textContent = 'Verbindung wird geprüft …';
  try { const data = await api('/api/connection', {}); $('#connectionResult').textContent = data.message; notice(data.message, !data.ok); await refresh(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; }
});
refresh(); setInterval(refresh, 15000);
