'use strict';
const { defaultSources, validateSources } = require('./sources');
const { normalizeSchedule } = require('./planning');
function fieldError(field, message) { return Object.assign(new Error(message), { field }); }
function validateConfig(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ungültige Konfiguration.');
  const out = {};
  for (const key of ['repository', 'password', 'fingerprint', 'namespace']) {
    if (typeof body[key] !== 'string' || body[key].length > 1024 || /[\r\n\0]/.test(body[key])) throw fieldError(key, `Ungültiges Feld: ${key}`);
    out[key] = key === 'password' ? (body[key] || current.password) : body[key].trim();
  }
  if (out.repository && (!/^[^\s]+@[^\s]+:[^\s:]+$/.test(out.repository) || out.repository.startsWith('-'))) throw fieldError('repository', 'Repository im Format user@realm@server:datastore angeben.');
  if (out.fingerprint && !/^([a-f\d]{2}:){31}[a-f\d]{2}$/i.test(out.fingerprint)) throw fieldError('fingerprint', 'Fingerprint muss ein SHA-256-Fingerprint sein.');
  if (out.namespace && !out.namespace.split('/').every(p => /^[a-zA-Z0-9_-]+$/.test(p))) throw fieldError('namespace', 'Ungültiger Namespace.');
  if (!body.schedules || typeof body.schedules !== 'object') throw fieldError('schedules', 'Zeitpläne fehlen.');
  try { out.sources = validateSources(body.sources ?? current.sources ?? defaultSources()); } catch (error) { error.field ||= 'sources'; throw error; }
  out.timezone = body.timezone ?? current.timezone ?? 'Europe/Berlin';
  try { if (typeof out.timezone !== 'string' || out.timezone.length > 80) throw new Error(); new Intl.DateTimeFormat('de', { timeZone: out.timezone }); } catch { throw fieldError('timezone', 'Ungültige Zeitzone.'); }
  out.staleAfterDays = body.staleAfterDays ?? current.staleAfterDays ?? 14;
  if (!Number.isInteger(out.staleAfterDays) || out.staleAfterDays < 1 || out.staleAfterDays > 365) throw fieldError('staleAfterDays', 'Warnschwelle muss 1 bis 365 Tage betragen.');
  out.authEnabled = body.authEnabled ?? current.authEnabled ?? true;
  if (typeof out.authEnabled !== 'boolean') throw new Error('Passwortschutz muss ein- oder ausgeschaltet sein.');
  out.notifications = validateNotifications(body.notifications ?? current.notifications ?? { enabled: false, url: '', token: '' }, current.notifications);
  out.schedules = {};
  for (const source of out.sources) { try { out.schedules[source.id] = normalizeSchedule(body.schedules[source.id] ?? current.schedules?.[source.id] ?? ''); } catch (error) { error.field = `schedules.${source.id}.time`; throw error; } }
  return out;
}
function validateNotifications(notify, current) {
  if (!notify || typeof notify !== 'object') throw new Error('Benachrichtigungseinstellungen fehlen.');
  if (typeof notify.enabled !== 'boolean' || typeof notify.url !== 'string' || typeof notify.token !== 'string' || notify.url.length > 1024 || notify.token.length > 1024 || /[\r\n\0]/.test(notify.token)) throw fieldError('notifications.token', 'Ungültige Benachrichtigungseinstellungen.');
  if (notify.url) { let url; try { url = new URL(notify.url); } catch { throw fieldError('notifications.url', 'Ungültige ntfy-Topic-URL.'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname === '/') throw fieldError('notifications.url', 'Vollständige ntfy-Topic-URL ohne Zugangsdaten angeben.'); }
  if (notify.enabled && !notify.url) throw fieldError('notifications.url', 'ntfy-Topic-URL fehlt.');
  return { enabled: notify.enabled, url: notify.url, token: notify.token || (notify.url === current?.url ? current.token : '') || '' };
}

module.exports = { validateConfig, validateNotifications };
