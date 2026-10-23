'use strict';
function repositoryFor(config, target = 'primary') {
  if (!['primary', 'secondary'].includes(target) && !/^extra[1-9][0-9]?$/.test(target)) throw new Error('Unbekanntes Backup-Ziel.');
  if (target === 'primary') return config.repository || '';
  if (target.startsWith('extra')) { const entry = config.additionalDatastores?.find(item => item.id === target); return entry && config.repository ? config.repository.slice(0, config.repository.lastIndexOf(':') + 1) + entry.datastore : ''; }
  if (!config.secondaryDatastore || !config.repository) return '';
  if (config.secondaryPBS) return `${config.secondaryPBS.authId}@${config.secondaryPBS.server}:${config.secondaryDatastore}`;
  return config.repository.slice(0, config.repository.lastIndexOf(':') + 1) + config.secondaryDatastore;
}
function targetConfig(config, target = 'primary') {
  const repository = repositoryFor(config, target);
  return { repository, ...Object.fromEntries(['password', 'fingerprint', 'namespace'].map(key => [key, target === 'secondary' && config.secondaryPBS ? config.secondaryPBS[key] : config[key]])) };
}
function targetsFor(config) {
  return ['primary', ...(config.secondaryDatastore ? ['secondary'] : []), ...(config.additionalDatastores || []).map(item => item.id)].map(id => {
    const target = targetConfig(config, id);
    return { id, name: target.repository ? target.repository.slice(target.repository.lastIndexOf(':') + 1) + (id === 'secondary' && config.secondaryPBS ? ' · ' + config.secondaryPBS.server : '') : 'Datastore 1', repository: target.repository, hasPassword: Boolean(target.password) };
  });
}
module.exports = { repositoryFor, targetConfig, targetsFor };
