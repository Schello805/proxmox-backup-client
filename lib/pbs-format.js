'use strict';
function parseSnapshots(value) {
  if (!Array.isArray(value)) throw new Error('PBS lieferte keine Snapshot-Liste.');
  return value.map(item => {
    if (!item || typeof item['backup-id'] !== 'string' || !['host','ct','vm'].includes(item['backup-type']) || !Number.isFinite(item['backup-time']) || item['backup-time'] < 0 || item['backup-time'] > 8640000000000) throw new Error('Unerwartetes PBS-Snapshot-Format.');
    return { group: `${item['backup-type']}/${item['backup-id']}`, id: item['backup-id'], time: new Date(item['backup-time'] * 1000).toISOString(), size: Number.isFinite(item.size) ? item.size : null, files: Array.isArray(item.files) ? item.files.map(f => typeof f === 'string' ? f : f?.filename).filter(f => typeof f === 'string').slice(0,100) : [], protected: Boolean(item.protected) };
  }).sort((a,b) => b.time.localeCompare(a.time));
}

module.exports = { parseSnapshots };
