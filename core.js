'use strict';
const FOLDERS = Object.freeze({ software: '/mnt/Daten/Software', filme: '/mnt/Daten/Filme', serien: '/mnt/Daten/Serien', hoerspiele: '/mnt/Daten/Hoerspiele', musik: '/mnt/Daten/Musik' });
function decodeMount(value) { return value.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8))); }
function mountFor(file, mountinfo) {
  return mountinfo.trim().split('\n').map(line => {
    const [left, right] = line.split(' - ');
    if (!right) return null;
    const fields = left.split(' '), after = right.split(' ');
    return { target: decodeMount(fields[4]), type: after[0], source: decodeMount(after[1]) };
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
  out.schedules = {};
  for (const folder of Object.keys(FOLDERS)) {
    out.schedules[folder] = normalizeSchedule(body.schedules[folder]);
  }
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
function scheduleKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const day = parts.slice(0, 10);
  return { day, time: parts.slice(11, 16), weekday: new Date(day + 'T12:00:00Z').getUTCDay() || 7 };
}
function scheduleDue(schedule, now, lastDay) {
  return schedule.days.includes(now.weekday) && schedule.time === now.time && lastDay !== now.day;
}
module.exports = { FOLDERS, mountFor, validateConfig, normalizeSchedule, scheduleKey, scheduleDue };
