'use strict';
const {selectionKey} = require('./file-selection');
const { repositoryFor, targetConfig } = require('./targets');
function compareRuns(source, config, state) {
  const records = [...(state.history?.[source.id] || [])];
  const job = state.jobs[source.id];
  if (job?.endedAt && !records.some(record => record.runId === job.runId)) records.push(job);
  const same = records.filter(record => record.status === 'success' && Number.isFinite(Date.parse(record.endedAt)) && record.path === source.path && (record.selectionKey||null)===selectionKey(source) && record.repository === repositoryFor(config, source.target) && (record.namespace || '') === targetConfig(config, source.target).namespace).sort((a,b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
  const metrics = run => run ? { endedAt: run.endedAt, durationSeconds: nonnegative(run.durationSeconds ?? (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000), processedBytes: nonnegative(run.progress?.processedBytes), uploadedBytes: nonnegative(run.progress?.uploadedBytes) } : null;
  const latest = metrics(same[0]), previous = metrics(same[1]), changes = {};
  if (latest && previous) for (const field of ['durationSeconds','processedBytes','uploadedBytes']) {
    const a = latest[field], b = previous[field];
    changes[field] = Number.isFinite(a) && Number.isFinite(b) ? { absolute: a-b, percent: b > 0 ? Math.round((a-b)/b*100) : null } : null;
  }
  return { latest, previous, changes };
}
module.exports = { compareRuns };
