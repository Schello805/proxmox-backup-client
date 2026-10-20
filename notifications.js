'use strict';
async function sendNotification(settings, message, { success = false } = {}) {
  if (!settings.enabled || !settings.url) throw new Error('ntfy ist nicht aktiviert. Zuerst ntfy-Einstellungen speichern.');
  let response;
  try {
    response = await fetch(settings.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000), headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'QNAP Backup Control', Tags: success ? 'white_check_mark' : 'warning', ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) }, body: message });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'ntfy antwortet nicht innerhalb von 7 Sekunden.' : 'ntfy nicht erreichbar. Serveradresse, DNS, Netzwerk und TLS-Zertifikat prüfen; direkte Topic-URL ohne Weiterleitung verwenden.');
  }
  await response.body?.cancel();
  if (!response.ok) {
    const hints = { 400: 'Topic und Serveradresse prüfen.', 401: 'Token fehlt oder ist ungültig.', 403: 'Keine Schreibrechte auf dieses Topic.', 404: 'Serveradresse bzw. Topic-Pfad nicht gefunden.', 429: 'Zu viele Nachrichten. Später erneut versuchen.' };
    throw new Error(`ntfy meldet HTTP ${response.status}. ${hints[response.status] || 'Serverkonfiguration prüfen.'}`);
  }
}
module.exports = { sendNotification };
