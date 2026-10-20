'use strict';
const { sendNotification } = require('../notifications');
function createNotifier({ getConfig, state, persist }) {
  let notificationChain = Promise.resolve();
  function notify(key, message) { const config = getConfig();
    if (!config.notifications.enabled || state.alerted[key]) return;
    state.alerted[key] = new Date().toISOString();
    const entries = Object.entries(state.alerted); if (entries.length > 1000) state.alerted = Object.fromEntries(entries.slice(-500));
    persist();
    const settings = { ...config.notifications };
    notificationChain = notificationChain.then(async () => {
      try { await sendNotification(settings, message); state.notification = { ok: true, at: new Date().toISOString(), message: 'Meldung zugestellt.' }; }
      catch { state.notification = { ok: false, at: new Date().toISOString(), message: 'ntfy-Zustellung fehlgeschlagen. URL, Token und Netzwerk prüfen.' }; }
      persist();
    });
  }
  return { notify };

}
module.exports = { createNotifier };
