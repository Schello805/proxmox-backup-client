'use strict';
async function sendNotification(settings, message) {
  if (!settings.enabled || !settings.url) throw new Error('ntfy ist nicht aktiviert.');
  const response = await fetch(settings.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000), headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'QNAP Backup Control', Tags: 'warning', ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) }, body: message });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`ntfy meldet HTTP ${response.status}.`);
}
module.exports = { sendNotification };
