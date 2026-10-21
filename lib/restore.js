'use strict';
const { targetConfig } = require('./targets');
function pbsContentLink(repository) {
  const at = repository.lastIndexOf('@'), colon = repository.lastIndexOf(':');
  if (at < 0 || colon <= at) return null;
  const authority = repository.slice(at + 1, colon), datastore = repository.slice(colon + 1);
  if (!/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d+)?$/.test(authority) || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(datastore)) return null;
  const port = authority.match(/:(\d+)$/)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  try {
    const url = new URL('https://' + authority); if (!port) url.port = '8007';
    url.hash = 'DataStore-' + encodeURIComponent(datastore) + ':content';
    return { url: url.href, datastore };
  } catch { return null; }
}
function restoreInfo(source, config, cache) {
  const target = targetConfig(config, source.target), link = pbsContentLink(target.repository);
  const group = 'host/' + source.id, archive = `qnap-${source.id}.pxar.didx`;
  return { source: source.id, name: source.name, target: source.target || 'primary', url: link?.url || null, datastore: link?.datastore || '', namespace: target.namespace || '', group, archive, hasPassword: Boolean(target.password), checkedAt: cache.checkedAt || null, error: cache.error || '', snapshots: (cache.snapshots || []).filter(snapshot => snapshot.group === group).map(snapshot => ({ time: snapshot.time, snapshot: `${group}/${snapshot.time.replace('.000Z','Z')}`, files: snapshot.files, archivePresent: snapshot.files.includes(archive) })) };
}
module.exports = { pbsContentLink, restoreInfo };
