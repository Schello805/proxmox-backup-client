'use strict';
const FOLDERS = Object.freeze({ software: '/mnt/Daten/Software', filme: '/mnt/Daten/Filme', serien: '/mnt/Daten/Serien', hoerspiele: '/mnt/Daten/Hoerspiele', musik: '/mnt/Daten/Musik', daten: '/mnt/Daten/Daten' });
function decodeMount(value) { return value.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8))); }
function mountFor(file, mountinfo) {
  return mountinfo.trim().split('\n').map(line => {
    const [left, right] = line.split(' - ');
    if (!right) return null;
    const fields = left.split(' '), after = right.split(' ');
    return { target: decodeMount(fields[4]), root: decodeMount(fields[3]), type: after[0], source: decodeMount(after[1]) };
  }).filter(m => m && (file === m.target || file.startsWith(m.target === '/' ? '/' : m.target + '/')))
    .sort((a, b) => b.target.length - a.target.length)[0] || null;
}
function validateConfig(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ungültige Konfiguration.');
  const out = {};
  for (const key of ['repository', 'password', 'fingerprint', 'namespace']) {
    if (typeof body[key] !== 'string' || body[key].length > 1024 || /[\r\n\0]/.test(body[key])) throw new Error(`Ungültiges Feld: ${key}`);
    out[key] = key === 'password' ? (body[key] || current.password) : body[key].trim();
  }
  if (out.repository && (!/^[^\s]+@[^\s]+:[^\s:]+$/.test(out.repository) || out.repository.startsWith('-'))) throw new Error('Repository im Format user@realm@server:datastore angeben.');
  if (out.fingerprint && !/^([a-f\d]{2}:){31}[a-f\d]{2}$/i.test(out.fingerprint)) throw new Error('Fingerprint muss ein SHA-256-Fingerprint sein.');
  if (out.namespace && !out.namespace.split('/').every(p => /^[a-zA-Z0-9_-]+$/.test(p))) throw new Error('Ungültiger Namespace.');
  if (!body.schedules || typeof body.schedules !== 'object') throw new Error('Zeitpläne fehlen.');
  out.sources = validateSources(body.sources ?? current.sources ?? defaultSources());
  out.timezone = body.timezone ?? current.timezone ?? 'Europe/Berlin';
  try { if (typeof out.timezone !== 'string' || out.timezone.length > 80) throw new Error(); new Intl.DateTimeFormat('de', { timeZone: out.timezone }); } catch { throw new Error('Ungültige Zeitzone.'); }
  out.staleAfterDays = body.staleAfterDays ?? current.staleAfterDays ?? 14;
  if (!Number.isInteger(out.staleAfterDays) || out.staleAfterDays < 1 || out.staleAfterDays > 365) throw new Error('Warnschwelle muss 1 bis 365 Tage betragen.');
  const notify = body.notifications ?? current.notifications ?? { enabled: false, url: '', token: '' };
  if (typeof notify.enabled !== 'boolean' || typeof notify.url !== 'string' || typeof notify.token !== 'string' || notify.url.length > 1024 || notify.token.length > 1024 || /[\r\n\0]/.test(notify.token)) throw new Error('Ungültige Benachrichtigungseinstellungen.');
  if (notify.url) { let url; try { url = new URL(notify.url); } catch { throw new Error('Ungültige ntfy-Topic-URL.'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname === '/') throw new Error('Vollständige ntfy-Topic-URL ohne Zugangsdaten angeben.'); }
  if (notify.enabled && !notify.url) throw new Error('ntfy-Topic-URL fehlt.');
  out.notifications = { enabled: notify.enabled, url: notify.url, token: notify.token || (notify.url === current.notifications?.url ? current.notifications.token : '') || '' };
  out.schedules = {};
  for (const source of out.sources) out.schedules[source.id] = normalizeSchedule(body.schedules[source.id] ?? current.schedules?.[source.id] ?? '');
  return out;
}
function normalizeSchedule(value) {
  // Version 1: eine Uhrzeit bedeutete täglich; leere Zeichenfolge war deaktiviert.
  if (typeof value === 'string') value = { days: value ? [1, 2, 3, 4, 5, 6, 7] : [], time: value };
  if (!value || typeof value !== 'object' || !Array.isArray(value.days) || typeof value.time !== 'string') throw new Error('Ungültiger Wochenplan.');
  if (value.days.length > 7 || value.days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(value.days).size !== value.days.length) throw new Error('Ungültige Wochentage.');
  if (value.days.length ? !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) : value.time !== '') throw new Error('Bitte eine gültige Uhrzeit für den Wochenplan wählen.');
  return { days: [...value.days].sort((a, b) => a - b), time: value.time };
}
const formatters = new Map();
function scheduleKey(date = new Date(), timezone = 'Europe/Berlin') {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const parts = formatters.get(timezone).format(date);
  const day = parts.slice(0, 10);
  return { day, time: parts.slice(11, 16), weekday: new Date(day + 'T12:00:00Z').getUTCDay() || 7 };
}
function scheduleDue(schedule, now, lastDay) {
  return schedule.days.includes(now.weekday) && schedule.time === now.time && lastDay !== now.day;
}


function defaultSources() {
  const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik', daten: 'Daten' };
  return Object.entries(FOLDERS).map(([id, path]) => ({ id, name: names[id], path, expectedSource: '' }));
}
function validSourcePath(value) {
  return typeof value === 'string' && value.length < 512 && !/[\r\n\0:]/.test(value) && value.startsWith('/mnt/Daten/') && !value.split('/').some(p => p === '..' || p === '.') && !value.endsWith('/') && !value.includes('//');
}
function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 30) throw new Error('1 bis 30 Quellen sind möglich.');
  const ids = new Set(), paths = [];
  return sources.map(source => {
    if (!source || !/^[a-z][a-z0-9_-]{0,39}$/.test(source.id) || ['constructor','prototype','__proto__'].includes(source.id) || ids.has(source.id)) throw new Error('Backup-ID muss eindeutig sein (kleine Buchstaben, Ziffern, Bindestriche).');
    if (typeof source.name !== 'string' || !source.name.trim() || source.name.length > 60 || /[\r\n\0]/.test(source.name)) throw new Error('Ungültiger Quellenname.');
    if (!validSourcePath(source.path) || paths.some(p => p === source.path || p.startsWith(source.path + '/') || source.path.startsWith(p + '/'))) throw new Error('Quellpfad muss eindeutig unter /mnt/Daten/ liegen; keine überlappenden Quellen.');
    if (typeof source.expectedSource !== 'string' || source.expectedSource.length > 512 || (source.expectedSource && !/^\/\/[^/\s]+\/[^\r\n\0]+$/.test(source.expectedSource))) throw new Error('Erwartete SMB-Quelle als //server/freigabe angeben.');
    ids.add(source.id); paths.push(source.path);
    return { id: source.id, name: source.name.trim(), path: source.path, expectedSource: source.expectedSource };
  });
}
function mountIssue(mount, expectedSource) {
  if (!mount || !['cifs','smb3'].includes(mount.type)) return 'Kein SMB/CIFS-Dateisystem unter diesem Pfad. Backup gesperrt.';
  if (expectedSource && mount.source !== expectedSource) return 'SMB-Quelle stimmt nicht mit der bestätigten Freigabe überein. Backup gesperrt.';
  return '';
}
// Lokale Uhrzeiten werden gegen mögliche UTC-Offsets geprüft: übersprungene
// DST-Uhrzeiten haben keinen Termin; doppelte Stunden erhalten nur den ersten.
const occurrenceCache = new Map();
function occurrence(day, time, timezone) {
  const key = `${timezone}/${day}/${time}`;
  if (occurrenceCache.has(key)) return occurrenceCache.get(key);
  const naive = Date.parse(`${day}T${time}:00Z`), offsets = new Set(), matches = [];
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = naive + hours * 3600000, local = scheduleKey(new Date(probe), timezone);
    offsets.add(Date.parse(`${local.day}T${local.time}:00Z`) - probe);
  }
  for (const offset of offsets) {
    const utc = naive - offset, local = scheduleKey(new Date(utc), timezone);
    if (local.day === day && local.time === time) matches.push(utc);
  }
  const result = matches.length ? Math.min(...matches) : null;
  if (occurrenceCache.size > 512) occurrenceCache.clear(); occurrenceCache.set(key, result);
  return result;
}
function scheduleWindow(schedule, timezone, now = new Date(), lastDay) {
  if (!schedule.days.length) return { nextAt: null, lastDueAt: null };
  const today = scheduleKey(now, timezone).day, current = now.getTime();
  let nextAt = null, lastDueAt = null;
  for (let delta = -15; delta <= 15; delta++) {
    const day = new Date(Date.parse(today + 'T12:00:00Z') + delta * 86400000).toISOString().slice(0,10);
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay() || 7;
    if (!schedule.days.includes(weekday)) continue;
    const timestamp = occurrence(day, schedule.time, timezone); if (timestamp === null) continue;
    if (timestamp <= current) lastDueAt = timestamp;
    if (timestamp > current && day !== lastDay && nextAt === null) nextAt = timestamp;
  }
  return { nextAt: nextAt === null ? null : new Date(nextAt).toISOString(), lastDueAt: lastDueAt === null ? null : new Date(lastDueAt).toISOString() };
}
function healthFor(schedule, timezone, now, watchSince, job = {}, staleAfterDays = 14, lastDay) {
  const window = scheduleWindow(schedule, timezone, now, lastDay), current = now.getTime();
  const due = window.lastDueAt && Date.parse(window.lastDueAt), success = Date.parse(job.lastSuccess || '') || 0;
  const busy = ['running','queued'].includes(job.status);
  const missed = Boolean(due && due >= Date.parse(watchSince) && current >= due + 10 * 60000 && success < due && !busy);
  const stale = Boolean(success && current - success > staleAfterDays * 86400000 && !busy);
  return { ...window, missed, stale, message: missed ? 'Geplanter Lauf ohne Erfolg (mehr als 10 Minuten überfällig).' : stale ? `Letzter Erfolg älter als ${staleAfterDays} Tage.` : '' };
}
function parseSnapshots(value) {
  if (!Array.isArray(value)) throw new Error('PBS lieferte keine Snapshot-Liste.');
  return value.map(item => {
    if (!item || typeof item['backup-id'] !== 'string' || !['host','ct','vm'].includes(item['backup-type']) || !Number.isFinite(item['backup-time']) || item['backup-time'] < 0 || item['backup-time'] > 8640000000000) throw new Error('Unerwartetes PBS-Snapshot-Format.');
    return { group: `${item['backup-type']}/${item['backup-id']}`, id: item['backup-id'], time: new Date(item['backup-time'] * 1000).toISOString(), size: Number.isFinite(item.size) ? item.size : null, files: Array.isArray(item.files) ? item.files.map(f => typeof f === 'string' ? f : f?.filename).filter(f => typeof f === 'string').slice(0,100) : [], protected: Boolean(item.protected) };
  }).sort((a,b) => b.time.localeCompare(a.time));
}
module.exports = { FOLDERS, defaultSources, validSourcePath, validateSources, mountFor, mountIssue, validateConfig, normalizeSchedule, scheduleKey, scheduleDue, occurrence, scheduleWindow, healthFor, parseSnapshots };
