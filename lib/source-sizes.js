'use strict';
const { mountIdentity } = require('./mounts');
// Serial, cancellable scans. Entries belong to the observed mount, not just its path.
function createSourceSizes({ run, inspectPath, isBusy = () => false, now = Date.now }) {
  const cache = new Map(), pending = new Map();
  let active = null;
  const keyFor = source => JSON.stringify([source.path, source.expectedSource]);
  function remove(key) {
    cache.delete(key); pending.delete(key);
    if (active?.key === key) active.controller.abort();
  }
  function drain() {
    if (active || isBusy() || !pending.size) return;
    const [key, entry] = pending.entries().next().value; pending.delete(key);
    const controller = new AbortController(); active = { key, controller }; entry.status = 'scanning';
    void (async () => {
      try {
        const before = await inspectPath(entry.source.path, entry.source.expectedSource);
        if (!before.ok || mountIdentity(before.mount) !== entry.identity) throw new Error('Mount geändert.');
        if (controller.signal.aborted) return;
        const { stdout } = await run('du', ['--summarize', '--bytes', '--one-file-system', '--', entry.source.path], { signal: controller.signal, timeout: 10 * 60_000, maxBuffer: 16384 });
        if (controller.signal.aborted) return;
        const match = stdout.match(/^(\d+)\t([^\r\n]+)\n?$/);
        const bytes = match && match[2] === entry.source.path ? Number(match[1]) : NaN;
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Ungültige Größenangabe.');
        const after = await inspectPath(entry.source.path, entry.source.expectedSource);
        if (!after.ok || mountIdentity(after.mount) !== entry.identity) throw new Error('Mount geändert.');
        if (cache.get(key) === entry && !controller.signal.aborted) Object.assign(entry, { status: 'ready', bytes, checkedAt: new Date(now()).toISOString(), error: '' });
      } catch {
        if (cache.get(key) === entry && !controller.signal.aborted) Object.assign(entry, { status: 'error', bytes: null, error: 'Größe nicht vollständig ermittelt: Mount geändert, Lesefehler oder Zeitlimit. Erneut aktualisieren.' });
      } finally {
        entry.finished = now(); active = null; drain();
      }
    })();
  }
  function read(source, available) {
    const key = keyFor(source);
    if (!available) { remove(key); return { status: 'unavailable', bytes: null }; }
    const identity = mountIdentity(source.mount);
    let entry = cache.get(key);
    if (entry && entry.identity !== identity) { remove(key); entry = null; }
    const ttl = entry?.status === 'error' ? 15 * 60_000 : 6 * 60 * 60_000;
    if (!entry || (['ready','error'].includes(entry.status) && now() - entry.finished >= ttl)) {
      entry = { source, identity, status: 'pending', bytes: null, checkedAt: null, error: '' };
      cache.set(key, entry); pending.set(key, entry);
    }
    drain();
    return { status: entry.status, bytes: entry.bytes, checkedAt: entry.checkedAt, error: entry.error };
  }
  function peek(source) {
    const entry = cache.get(keyFor(source));
    return entry?.status === 'ready' && entry.identity === mountIdentity(source.mount) && now() - entry.finished < 6 * 60 * 60_000 ? { bytes: entry.bytes, checkedAt: entry.checkedAt } : null;
  }
  function retain(sources) { const keys = new Set(sources.map(keyFor)); for (const key of cache.keys()) if (!keys.has(key)) remove(key); }
  function invalidate() { cache.clear(); pending.clear(); active?.controller.abort(); }
  return { read, peek, invalidate, retain };
}
module.exports = { createSourceSizes };
