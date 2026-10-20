'use strict';
function repositoryFor(config, target = 'primary') {
  if (!['primary', 'secondary'].includes(target)) throw new Error('Unbekanntes Backup-Ziel.');
  if (target === 'primary') return config.repository || '';
  if (!config.secondaryDatastore || !config.repository) return '';
  return config.repository.slice(0, config.repository.lastIndexOf(':') + 1) + config.secondaryDatastore;
}
function targetsFor(config) {
  return ['primary', ...(config.secondaryDatastore ? ['secondary'] : [])].map(id => {
    const repository = repositoryFor(config, id);
    return { id, name: repository ? repository.slice(repository.lastIndexOf(':') + 1) : 'Datastore 1', repository };
  });
}
module.exports = { repositoryFor, targetsFor };
