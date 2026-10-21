'use strict';
const { validateConfig, validateNotifications } = require('./validation');
const { SCHEMA_VERSION } = require('./storage');
const { repositoryFor, targetConfig } = require('./targets');
function createConfigService({ initial, state, write, persist, isBusy, onChange, password: PASS }) {
  let value = initial; const get = () => value;
  function replace(next) { next = { ...next, schemaVersion: SCHEMA_VERSION }; write(next); value = next; }
  function apply(input, { replaceSecrets = false } = {}) { const config = get();
    if (isBusy()) throw Object.assign(new Error('Ein Auftrag oder eine PBS-Abfrage läuft. Bitte kurz warten.'), { status: 409 });
    const next = validateConfig(input, replaceSecrets ? { ...config, password: '', secondaryPBS: config.secondaryPBS ? { ...config.secondaryPBS, password: '' } : null, notifications: { ...config.notifications, token: '' } } : config), now = new Date().toISOString();
    if (next.authEnabled && PASS.length < 6) throw new Error('APP_PASSWORD mit mindestens 6 Zeichen fehlt.');
    for (const source of next.sources) {
      const old = config.sources.find(item => item.id === source.id), targetChanged = repositoryFor(config, old?.target) !== repositoryFor(next, source.target) || targetConfig(config, old?.target).namespace !== targetConfig(next, source.target).namespace;
      const pathChanged = old && old.path !== source.path;
      if (!old || config.timezone !== next.timezone || targetChanged || pathChanged || JSON.stringify(config.schedules[source.id]) !== JSON.stringify(next.schedules[source.id])) state.watchSince[source.id] = now;
      if (!old || targetChanged || pathChanged) state.jobs[source.id] = { status: 'idle' };
    }
    replace(next); onChange(config, next); persist();
  }

  function setPolicy(input) { replace({ ...get(), backupPolicy: require('./backup-policy').validatePolicy(input) }); }
  function setAuth(enabled) {
   if (typeof enabled !== 'boolean') throw new Error('Passwortschutz muss ein- oder ausgeschaltet sein.');
   if (enabled && PASS.length < 6) throw new Error('Zum Einschalten APP_PASSWORD mit mindestens 6 Zeichen setzen und den Dienst neu starten.');
   replace({ ...get(), authEnabled: enabled });
  }
  function setNotifications(input) { const notifications = validateNotifications(input, get().notifications); replace({ ...get(), notifications }); state.notification = null; persist(); }
  function safe(snapshot = get()) { return { ...snapshot, canEnableAuth: PASS.length >= 6, password: '', hasPassword: Boolean(snapshot.password), secondaryPBS: snapshot.secondaryPBS ? { ...snapshot.secondaryPBS, password: '', hasPassword: Boolean(snapshot.secondaryPBS.password) } : null, notifications: { ...snapshot.notifications, token: '', hasToken: Boolean(snapshot.notifications.token) } }; }
  return { get, apply, setPolicy, setAuth, setNotifications, safe, sourceFor: id => get().sources.find(source => source.id === id) };

}
module.exports = { createConfigService };
