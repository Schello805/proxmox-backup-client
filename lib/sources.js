'use strict';
const FOLDERS = Object.freeze({ software: '/mnt/Daten/Software', filme: '/mnt/Daten/Filme', serien: '/mnt/Daten/Serien', hoerspiele: '/mnt/Daten/Hoerspiele', musik: '/mnt/Daten/Musik', daten: '/mnt/Daten/Daten' });
function defaultSources() {
  const names = { software: 'Software', filme: 'Filme', serien: 'Serien', hoerspiele: 'Hörspiele', musik: 'Musik', daten: 'Daten' };
  return Object.entries(FOLDERS).map(([id, path]) => ({ id, name: names[id], path, expectedSource: '' }));
}
function validSourcePath(value) {
  return typeof value === 'string' && value.length < 512 && !/[\r\n\0:]/.test(value) && value.startsWith('/mnt/Daten/') && !value.split('/').some(p => p === '..' || p === '.') && !value.endsWith('/') && !value.includes('//');
}
function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 30) throw new Error('1 bis 30 Quellen sind möglich.');
  const ids = new Set(), paths = [];
  return sources.map((source, index) => {
    const fail = (field, message) => Object.assign(new Error(message), { field: `sources.${index}.${field}` });
    if (!source || !/^[a-z][a-z0-9_-]{0,39}$/.test(source.id) || ['constructor','prototype','__proto__'].includes(source.id) || ids.has(source.id)) throw fail('id', 'Backup-ID muss eindeutig sein (kleine Buchstaben, Ziffern, Bindestriche).');
    if (typeof source.name !== 'string' || !source.name.trim() || source.name.length > 60 || /[\r\n\0]/.test(source.name)) throw fail('name', 'Ungültiger Quellenname.');
    if (!validSourcePath(source.path) || paths.some(p => p === source.path || p.startsWith(source.path + '/') || source.path.startsWith(p + '/'))) throw fail('path', 'Quellpfad muss eindeutig unter /mnt/Daten/ liegen; keine überlappenden Quellen.');
    if (typeof source.expectedSource !== 'string' || source.expectedSource.length > 512 || (source.expectedSource && !/^\/\/[^/\s]+\/[^\r\n\0]+$/.test(source.expectedSource))) throw fail('expectedSource', 'Erwartete SMB-Quelle als //server/freigabe angeben.');
    if (source.target !== undefined && !['primary', 'secondary'].includes(source.target)) throw fail('target', 'Unbekanntes Backup-Ziel.');
    ids.add(source.id); paths.push(source.path);
    return { id: source.id, name: source.name.trim(), path: source.path, expectedSource: source.expectedSource, target: source.target || 'primary' };
  });
}

module.exports = { FOLDERS, defaultSources, validSourcePath, validateSources };
