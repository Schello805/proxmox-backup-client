'use strict';
function parseDriveCapacity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger Google-Speicherstand.');
  const out = {};
  for (const key of ['total','used','free','trashed','other']) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error('Ungültiger Google-Speicherstand.');
    out[key === 'free' ? 'available' : key] = value[key] ?? null;
  }
  if (Object.values(out).every(value => value === null)) { if (!Object.keys(value).length) return { ...out, usedPercent:null, unsupported:true }; throw new Error('Google meldet keinen gültigen Speicherstand.'); }
  // Free includes Google-wide use (Drive, Photos, Gmail); `used` alone is Drive use.
  out.usedPercent = out.total > 0 && out.available !== null ? Math.max(0, Math.min(100, Math.round((out.total - out.available) / out.total * 1000) / 10)) : null;
  return out;
}
module.exports = { parseDriveCapacity };
