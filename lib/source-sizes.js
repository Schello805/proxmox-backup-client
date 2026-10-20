'use strict';
// One recursive scan at a time; status requests only read the in-memory cache.
function createSourceSizes({ run, inspectPath, isBusy = () => false, now = Date.now }) {
  const cache = new Map();
  let running = false;
  function read(source, available) {
    if (!available) return { status: 'unavailable', bytes: null };
    const key = JSON.stringify([source.path, source.expectedSource]);
    let entry = cache.get(key);
    const ttl = entry?.error ? 15 * 60_000 : 6 * 60 * 60_000;
    if (!running && !isBusy() && (!entry || now() - entry.finished >= ttl)) {
      entry = { ...entry, status: 'scanning' };
      cache.set(key, entry);
      running = true;
      void (async () => {
        try {
          const check = await inspectPath(source.path, source.expectedSource);
          if (!check.ok) throw new Error('Quelle nicht verfügbar.');
          const { stdout } = await run('du', ['--summarize', '--bytes', '--one-file-system', '--', source.path], { timeout: 10 * 60_000, maxBuffer: 16384 });
          const bytes = Number(stdout.match(/^(\d+)\s/)?.[1]);
          if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Ungültige Größenangabe.');
          Object.assign(entry, { status: 'ready', bytes, checkedAt: new Date(now()).toISOString(), error: '' });
        } catch {
          Object.assign(entry, { status: 'error', error: 'Größe konnte nicht vollständig ermittelt werden (Leserechte oder Zeitlimit).', bytes: null });
        } finally {
          entry.finished = now();
          running = false;
        }
      })();
    }
    return entry ? { status: entry.status, bytes: entry.bytes ?? null, checkedAt: entry.checkedAt || null, error: entry.error || '' } : { status: 'pending', bytes: null };
  }
  return { read };
}
module.exports = { createSourceSizes };
