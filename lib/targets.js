'use strict';
function repositoryFor(config, target = 'primary') {
  if (!['primary', 'secondary'].includes(target)) throw new Error('Unbekanntes Backup-Ziel.');
  if (target === 'primary') return config.repository || '';
  if (!config.secondaryDatastore || !config.repository) return '';
  if (config.secondaryPBS) return `${config.secondaryPBS.authId}@${config.secondaryPBS.server}:${config.secondaryDatastore}`;
  return config.repository.slice(0, config.repository.lastIndexOf(':') + 1) + config.secondaryDatastore;
}
function targetConfig(config, target = 'primary') {
  const repository = repositoryFor(config, target);
  return { repository, ...Object.fromEntries(['password', 'fingerprint', 'namespace'].map(key => [key, target === 'secondary' && config.secondaryPBS ? config.secondaryPBS[key] : config[key]])) };
}
function targetsFor(config) {
  return ['primary', ...(config.secondaryDatastore ? ['secondary'] : [])].map(id => {
    const target = targetConfig(config, id);
    return { id, name: target.repository ? target.repository.slice(target.repository.lastIndexOf(':') + 1) + (id === 'secondary' && config.secondaryPBS ? ' · ' + config.secondaryPBS.server : '') : 'Datastore 1', repository: target.repository, hasPassword: Boolean(target.password) };
  });
}
module.exports = { repositoryFor, targetConfig, targetsFor };
