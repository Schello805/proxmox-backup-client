'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function createHistory({ state, data: DATA, persist, getConfig, password: PASS }) {
  const sourceFor = id => getConfig().sources.find(source => source.id === id);
  const readLog = id => fs.existsSync(path.join(DATA, id + '.log')) ? fs.readFileSync(path.join(DATA, id + '.log'), 'utf8') : '';
  function redact(text) { const config = getConfig(); for (const secret of [config.password, config.secondaryPBS?.password, config.notifications.token, PASS]) if (secret) text = text.split(secret).join('[ausgeblendet]'); return text; }
  function log(id, text) { fs.writeFileSync(path.join(DATA, id + '.log'), Buffer.from(readLog(id) + redact(text)).subarray(-256 * 1024), { mode: 0o600 }); }
  function archive(id, job) {
    if (!job.endedAt) return;
    job.runId ||= crypto.randomUUID(); state.history[id] ||= [];
    if (state.history[id].some(entry => entry.runId === job.runId)) return;
    const dir = path.join(DATA, 'history', id); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, job.runId + '.log'), readLog(id), { mode: 0o600 });
    state.history[id].unshift({ runId: job.runId, startedAt: job.startedAt || null, endedAt: job.endedAt, status: job.status, verification: job.verification || null, transferredAt: job.transferredAt || null, source: job.source || 'unknown', progress: job.progress || null, estimatedTotalBytes: job.estimatedTotalBytes ?? null, sizeCheckedAt: job.sizeCheckedAt || null, error: job.error || '', exitCode: job.exitCode ?? null, durationSeconds: job.startedAt ? Math.max(0, Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000)) : null, path: job.path || sourceFor(id)?.path, repository: job.repository || '', namespace: job.namespace || '' });
    for (const old of state.history[id].splice(10)) fs.rmSync(path.join(dir, old.runId + '.log'), { force: true });
  }
  for (const [id, job] of Object.entries(state.jobs)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id)) continue;
    if (['running','queued','cancelling'].includes(job.status)) { job.status = 'interrupted'; job.endedAt = new Date().toISOString(); job.error = 'Dienst wurde während des Auftrags beendet.'; }
    archive(id, job);
  }
  persist();
  return { readLog, log, archive };

}
module.exports = { createHistory };
