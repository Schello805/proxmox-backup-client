'use strict';
const { sendNotification } = require('../notifications');
function createNotifier({ getConfig, state, persist, send = sendNotification }) {
  let notificationChain = Promise.resolve();
  function notify(key, message, options = {}) { const config = getConfig();
    if (!config.notifications.enabled || (options.success && !config.notifications.success) || state.alerted[key]) return;
    state.alerted[key] = new Date().toISOString();
    const entries = Object.entries(state.alerted); if (entries.length > 1000) state.alerted = Object.fromEntries(entries.slice(-500));
    persist();
    const settings = { ...config.notifications };
    notificationChain = notificationChain.then(async () => {
      try { await send(settings, message, {success:Boolean(options.success && !options.warning)}); state.notification = { ok: true, at: new Date().toISOString(), message: 'Meldung zugestellt.' }; }
      catch { state.notification = { ok: false, at: new Date().toISOString(), message: 'ntfy-Zustellung fehlgeschlagen. URL, Token und Netzwerk prüfen.' }; }
      persist();
    });
  }
  return { notify, flush: () => notificationChain };

}
module.exports = { createNotifier };
