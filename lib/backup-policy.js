'use strict';
const { scheduleKey } = require('./planning');
function validatePolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Backup-Regeln.');
  const policy = { windowEnabled: value.windowEnabled ?? false, start: value.start ?? '22:00', end: value.end ?? '06:00', rateMiB: value.rateMiB ?? 0, driveRateMiB: value.driveRateMiB ?? value.rateMiB ?? 0 };
  if (typeof policy.windowEnabled !== 'boolean' || ![policy.start, policy.end].every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || (policy.windowEnabled && policy.start === policy.end)) throw new Error('Startfenster braucht unterschiedliche gültige Uhrzeiten.');
  if (!Number.isInteger(policy.rateMiB) || policy.rateMiB < 0 || policy.rateMiB > 10000) throw new Error('Bandbreite muss 0 bis 10000 MiB/s betragen.');
  if (!Number.isInteger(policy.driveRateMiB) || policy.driveRateMiB < 0 || policy.driveRateMiB > 10000) throw new Error('Google-Drive-Bandbreite muss 0 bis 10000 MiB/s betragen.');
  return policy;
}
function inWindow(config, now = new Date()) {
  const p = validatePolicy(config.backupPolicy);
  if (!p.windowEnabled) return true;
  const time = scheduleKey(now, config.timezone).time;
  return p.start < p.end ? time >= p.start && time < p.end : time >= p.start || time < p.end;
}
function rateArgs(config) { const bytes = validatePolicy(config.backupPolicy).rateMiB * 1024 ** 2; return bytes ? ['--rate', String(bytes), '--burst', String(bytes)] : []; }
module.exports = { validatePolicy, inWindow, rateArgs };
