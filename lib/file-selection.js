'use strict';
const crypto = require('node:crypto');
const validEntryName = name => typeof name === 'string' && Boolean(name) && !/[\r\n\0/]/.test(name) && !['.','..'].includes(name) && Buffer.byteLength(name) <= 255;
const selectionKey = source => source?.selection ? crypto.createHash('sha256').update(JSON.stringify([...source.selection].sort())).digest('hex') : null;
function selectionArgs(source) {
  if (!source.selection) return [];
  return ['--exclude', '/*', ...source.selection.flatMap(name => ['--exclude', '!/' + name.replace(/[\\*?\[\]!]/g, '\\$&')])];
}
// Metadata only; never writes exclusion files or changes the NAS. Individual argv entries
// avoid Linux's per-argument size limit for large filename selections.
const selectionScript = `const fs=require('fs'),path=require('path'); // QNAP_FILE_SELECTION
try { const root=process.argv[1],selection=process.argv.slice(2);
if(fs.realpathSync(root)!==root)throw Error('Quellpfad ist ein Verweis.');
const names=fs.readdirSync(root);if(names.length>5000)throw Error('Maximal 5000 Einträge unterstützt.');
if(names.includes('.pxarexclude'))throw Error('.pxarexclude in der Quelle kann die Dateiauswahl überschreiben. Datei-Aufteilung gesperrt.');
let bytes=0;for(const name of selection){const stat=fs.lstatSync(path.join(root,name));if(!stat.isFile())throw Error('Ausgewählte Datei fehlt oder ist keine reguläre Datei: '+name);bytes+=stat.size;}
process.stdout.write(JSON.stringify({names,bytes}));
} catch(error){process.stdout.write(JSON.stringify({error:error.code==='ENOENT'?'Ausgewählte Datei fehlt. Zuordnung aktualisieren.':error.code?'Quelldateien konnten nicht geprüft werden.':error.message}));}`;
async function inspectFileSelection(source, config, run, options = {}) {
  if (!Array.isArray(source.selection) || !source.selection.length || source.selection.length > 5000 || !source.selection.every(validEntryName) || new Set(source.selection).size !== source.selection.length) throw new Error('Ungültige Dateiauswahl.');
  let data;
  try { const {stdout}=await run(process.execPath, ['-e', selectionScript, source.path, ...source.selection], {timeout:30000,maxBuffer:4*1024*1024,...options});data=JSON.parse(stdout); }
  catch { throw new Error('Dateiauswahl konnte nicht vollständig gelesen werden: Lesefehler oder Zeitlimit.'); }
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.names) || !data.names.every(validEntryName) || !Number.isSafeInteger(data.bytes) || data.bytes < 0) throw new Error('Dateiauswahl konnte nicht vollständig geprüft werden.');
  if (config) {
    const parent = config.sources.find(item => item.id === source.parentId);
    if (!parent?.partitioned || parent.path !== source.path) throw new Error('Hauptquelle der Dateiauswahl fehlt.');
    const assigned = new Set(parent.partitionSkipped || []);
    for (const child of config.sources.filter(item => item.parentId === parent.id)) {
      if (child.selection) for (const name of child.selection) assigned.add(name);
      else assigned.add(child.path.slice(parent.path.length + 1));
    }
    const missing = data.names.filter(name => !assigned.has(name));
    if (missing.length) throw new Error(`${missing.length} neue Einträge ohne Zuordnung. Unter Quellen die Aufteilung aktualisieren.`);
  }
  return {bytes:data.bytes,checkedAt:new Date().toISOString()};
}
module.exports = {validEntryName, selectionKey, selectionArgs, inspectFileSelection};
