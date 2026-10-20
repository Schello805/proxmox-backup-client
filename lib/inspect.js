'use strict';
const fs = require('node:fs');
const { validSourcePath } = require('./sources');
const { mountFor, mountIssue } = require('./mounts');
function createInspector(run) {
  async function inspectPath(target, expectedSource = '') {
    if (!validSourcePath(target)) throw new Error('Quellpfad muss unter /mnt/Daten/ liegen.');
    try {
      const mounts = await fs.promises.readFile('/proc/self/mountinfo', 'utf8');
      const { stdout } = await run(process.execPath, ['-e', "const fs=require('fs');const p=process.argv[1];if(!fs.statSync(p).isDirectory())process.exit(1);const d=fs.opendirSync(p);d.closeSync();process.stdout.write(fs.realpathSync(p));", target], { timeout: 8000, maxBuffer: 16384 });
      if (!validSourcePath(stdout)) return { ok: false, path: target, error: 'Der tatsächliche Pfad liegt außerhalb des erlaubten Quellenbereichs.' };
      const mount = mountFor(stdout, mounts), error = mountIssue(mount, expectedSource);
      return { ok: !error, path: target, mount, error, identityConfirmed: Boolean(expectedSource && !error) };
    } catch (e) { return { ok: false, path: target, error: e.killed ? 'SMB-Prüfung hat das Zeitlimit überschritten.' : 'Pfad nicht lesbar oder Mount-Prüfung fehlgeschlagen.' }; }
  }
  return inspectPath;

}
module.exports = { createInspector };
