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
    const value = body.schedules[folder];
    if (typeof value !== 'string' || (value !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error(`Ungültige Uhrzeit für ${folder}.`);
    out.schedules[folder] = value;
  }
  return out;
}
function scheduleKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return { day: parts.slice(0, 10), time: parts.slice(11, 16) };
}
module.exports = { FOLDERS, mountFor, validateConfig, scheduleKey };
