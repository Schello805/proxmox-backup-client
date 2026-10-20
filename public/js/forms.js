export function createFormState(forms) {
  const states = new Map();
  for (const form of forms) {
    const state = { dirty: false, version: 0, form }; states.set(form.id, state);
    const changed = () => { state.dirty = true; state.version++; if (form.dataset) form.dataset.dirty = 'true'; };
    form.addEventListener('input', changed); form.addEventListener('change', changed);
  }
  return {
    dirty: id => states.get(id)?.dirty || false,
    touch(id) { const state = states.get(id); state.dirty = true; state.version++; if (state.form.dataset) state.form.dataset.dirty = 'true'; },
    capture: id => states.get(id).version,
    clean(id, version) { const state = states.get(id); if (state.version !== version) return false; state.dirty = false; if (state.form.dataset) state.form.dataset.dirty = 'false'; return true; }
  };
}
export function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach(element => element.remove());
  form.querySelectorAll('[aria-invalid]').forEach(element => { element.removeAttribute('aria-invalid'); const id = element.getAttribute('aria-describedby'); if (id?.startsWith('error-')) element.removeAttribute('aria-describedby'); });
}
export function showFieldErrors(form, errors) {
  clearFieldErrors(form);
  for (const [name, message] of Object.entries(errors)) {
    const field = form.elements.namedItem(name); if (!field?.tagName) continue;
    const text = document.createElement('small'); text.className = 'field-error'; text.textContent = message; text.id = `error-${form.id}-${name}`;
    field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', text.id); field.insertAdjacentElement('afterend', text);
    field.addEventListener('input', () => { text.remove(); field.removeAttribute('aria-invalid'); if (field.getAttribute('aria-describedby') === text.id) field.removeAttribute('aria-describedby'); }, { once: true });
  }
}
export function serverField(error) {
  if (error.field?.startsWith('sources.')) return error.field.split('.').at(-1);
  if (error.field?.startsWith('schedules.')) return `schedule-${error.field.split('.')[1]}`;
  return ({ 'secondaryPBS.fingerprint': 'secondaryFingerprint', 'secondaryPBS.namespace': 'secondaryNamespace', 'secondaryPBS.password': 'secondaryPassword', repository: 'server', 'notifications.url': 'server', 'notifications.token': 'token', 'notifications.enabled': 'enabled' })[error.field] || error.field;
}
export function validateMainForm(values) {
  const errors = {}, needsTarget = Boolean(values.server || values.authId || values.password);
  if (needsTarget && !values.server) errors.server = 'PBS-Adresse fehlt.';
  if (values.server && /[\s/@]/.test(values.server)) errors.server = 'Nur Hostname/IP und optional Port angeben, ohne https://.';
  if (needsTarget && !/^[^\s@]+@[^\s@]+$/.test(values.authId)) errors.authId = 'Benutzer mit Realm angeben, z. B. backup@pbs oder root@pam.';
  if (needsTarget && (!values.datastore || /[\s:]/.test(values.datastore))) errors.datastore = 'Datastore ohne Leerzeichen oder Doppelpunkt angeben.';
  if (values.secondaryDatastore && (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(values.secondaryDatastore) || (!values.secondaryPBS && values.secondaryDatastore === values.datastore) || !values.server)) errors.secondaryDatastore = 'Anderen Datastore-Namen auf demselben PBS angeben.';
  if (values.capacityWarnPercent !== undefined && (!Number.isInteger(values.capacityWarnPercent) || values.capacityWarnPercent < 50 || values.capacityWarnPercent > 99)) errors.capacityWarnPercent = '50 bis 99 Prozent angeben.';
  if (values.fingerprint && !/^([a-f\d]{2}:){31}[a-f\d]{2}$/i.test(values.fingerprint)) errors.fingerprint = 'SHA-256-Fingerprint: 32 durch Doppelpunkte getrennte Hex-Paare.';
  if (values.namespace && !values.namespace.split('/').every(part => /^[\w-]+$/.test(part))) errors.namespace = 'Nur Buchstaben, Ziffern, _ und -; Ebenen mit / trennen.';
  try { if (!values.timezone) throw new Error(); new Intl.DateTimeFormat('de', { timeZone: values.timezone }); } catch { errors.timezone = 'Gültige Zeitzone wählen, z. B. Europe/Berlin.'; }
  if (!Number.isInteger(values.staleAfterDays) || values.staleAfterDays < 1 || values.staleAfterDays > 365) errors.staleAfterDays = '1 bis 365 Tage angeben.';
  for (const [id, schedule] of Object.entries(values.schedules)) if (schedule.days.length && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) errors[`schedule-${id}`] = 'Uhrzeit für die gewählten Tage fehlt.';
  return errors;
}
export function validateNotifyForm(values) {
  const errors = {};
  if (values.enabled && !values.topic) errors.topic = 'Topic fehlt, z. B. mein-backup-topic.';
  if (values.topic || values.enabled) {
    try { const url = new URL(values.server); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); }
    catch { errors.server = 'Server als http(s)-Adresse ohne Zugangsdaten angeben.'; }
  }
  return errors;
}

export function validateSourceForm(source, sources, editing) {
  const errors = {}, other = sources.filter(item => item.id !== editing);
  if (!source.name || source.name.length > 60) errors.name = 'Name mit 1 bis 60 Zeichen angeben.';
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(source.id) || ['constructor','prototype','__proto__'].includes(source.id) || other.some(item => item.id === source.id)) errors.id = 'Eindeutige Backup-ID aus kleinen Buchstaben, Ziffern, _ und - angeben.';
  if (!source.path.startsWith('/mnt/Daten/') || source.path.endsWith('/') || source.path.includes('//') || /[\r\n\0:]/.test(source.path) || source.path.split('/').some(part => ['.','..'].includes(part)) || other.some(item => item.path === source.path || item.path.startsWith(source.path + '/') || source.path.startsWith(item.path + '/'))) errors.path = 'Eindeutiger, nicht überlappender Ordner unter /mnt/Daten/ erforderlich.';
  if (source.expectedSource && !/^\/\/[^/\s]+\/[^\r\n\0]+$/.test(source.expectedSource)) errors.expectedSource = 'Freigabe als //server/freigabe angeben oder leer lassen.';
  return errors;
}
