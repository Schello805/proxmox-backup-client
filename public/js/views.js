export const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export function createViews(getTimezone, statuses, documentAdapter = globalThis.document) {
const date = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: getTimezone() }).format(new Date(value)) : 'Noch kein Erfolg';
function element(tag, text, className) { const el = documentAdapter.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function nextText(health) { return health?.nextAt ? `Nächster: ${date(health.nextAt)}` : 'Kein automatischer Termin'; }
function renderJob(cell, job, health) {
  const warning = health?.message, label = warning && !['running','queued','failed','interrupted'].includes(job.status) ? (health.missed ? 'Überfällig' : 'Erfolg zu alt') : statuses[job.status];
  cell.replaceChildren(element('span', label, `badge ${['failed','interrupted'].includes(job.status) ? 'bad' : ['running','queued'].includes(job.status) || warning ? 'busy' : job.status === 'success' ? 'ok' : ''}`));
  const error = job.error || warning;
  if (error) { const text = element('small', error, 'row-error'); text.title = error; cell.append(text); }
}
function scheduleText(schedule) {
  if (!schedule.days.length) return 'Nur manuell';
  const days = schedule.days.join(',');
  const label = days === '1,2,3,4,5,6,7' ? 'Täglich' : days === '1,2,3,4,5' ? 'Mo–Fr' : days === '6,7' ? 'Sa–So' : schedule.days.map(day => dayNames[day - 1]).join(', ');
  return `${label} · ${schedule.time}`;
}
return { element, date, nextText, renderJob, scheduleText };
}
