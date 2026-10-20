export const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export function createViews(getTimezone, statuses, documentAdapter = globalThis.document) {
const date = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: getTimezone() }).format(new Date(value)) : 'Noch kein Erfolg';
function element(tag, text, className) { const el = documentAdapter.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function nextText(health) { return health?.nextAt ? `Nächster: ${date(health.nextAt)}` : 'Kein automatischer Termin'; }
function renderJob(cell, job, health) {
  const warning = health?.message, label = warning && !['running','queued','cancelling','cancelled','failed','interrupted'].includes(job.status) ? (health.missed ? 'Überfällig' : 'Erfolg zu alt') : statuses[job.status];
  cell.replaceChildren(element('span', label, `badge ${['failed','interrupted'].includes(job.status) ? 'bad' : ['running','queued','cancelling'].includes(job.status) || warning ? 'busy' : job.status === 'success' ? 'ok' : ''}`));
  const error = job.error || warning;
  if (error) { const text = element('small', error, 'row-error'); text.title = error; cell.append(text); }
}
function scheduleText(schedule) {
  if (!schedule.days.length) return 'Nur manuell';
  const days = schedule.days.join(',');
  const label = days === '1,2,3,4,5,6,7' ? 'Täglich' : days === '1,2,3,4,5' ? 'Mo–Fr' : days === '6,7' ? 'Sa–So' : schedule.days.map(day => dayNames[day - 1]).join(', ');
  return `${label} · ${schedule.time}`;
}
function renderEstimate(container, job, queueText = '') {
  container.replaceChildren(); container.classList.toggle('progress-line', Boolean(job));
  if (job) {
    const estimate = job.estimate || {}, progress = element('progress');
    progress.max = 100; progress.setAttribute('aria-label', 'Geschätzter Backup-Fortschritt');
    if (estimate.percent != null) { progress.value = estimate.percent; container.append(progress); }
    const messages = { 'waiting-size': 'Prozent und Restzeit: Quellgröße noch nicht verfügbar.', 'waiting-data': 'Warte auf Fortschrittsdaten des Clients …', stale: 'Keine aktuellen Messwerte · Restzeit offen.', 'size-reached': 'Datenmenge erreicht · Restzeit offen.', unavailable: 'Restzeit noch nicht bestimmbar.' };
    let text = estimate.percent != null ? `${estimate.status === 'complete' ? '' : 'ca. '}${estimate.percent} %` : '';
    if (estimate.status === 'estimating') {
      const seconds = estimate.remainingSeconds;
      const eta = seconds == null ? 'offen' : seconds < 60 ? 'unter 1 min' : seconds < 3600 ? `ca. ${Math.ceil(seconds / 60)} min` : `ca. ${Math.floor(seconds / 3600)} h ${Math.ceil(seconds % 3600 / 60)} min`;
      text += ` · Restzeit ${eta}`;
    } else text += `${text ? ' · ' : ''}${estimate.status === 'complete' ? 'Abgeschlossen' : messages[estimate.status] || messages.unavailable}`;
    const label = element('span', text); label.id = 'progressEstimate';
    label.title = estimate.status === 'complete' ? 'Backup erfolgreich abgeschlossen.' : `Schätzung anhand der Quellgröße${estimate.sizeCheckedAt ? ' vom ' + date(estimate.sizeCheckedAt) : ''} und der Client-Messwerte. Dateiausschlüsse, Änderungen und der Backup-Abschluss können die Dauer verändern. 100 % erst bei Erfolg.`;
    container.append(label);
  }
  if (queueText) container.append(element('span', queueText, 'queue-text'));
}
return { element, date, nextText, renderJob, scheduleText, renderEstimate };
}
