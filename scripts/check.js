#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { loadConfig, loadState, checkRuntime } = require('../lib/storage');
function envFile(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (!match) throw new Error('Ungültige Zeile in EnvironmentFile. Format NAME=Wert verwenden.');
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) { const quote = value[0]; if (!value.endsWith(quote)) throw new Error('Nicht geschlossene Anführungszeichen in EnvironmentFile.'); value = value.slice(1, -1); }
    env[match[1]] = value;
  }
  return env;
}
function main() {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  if (option('--env-file')) Object.assign(process.env, envFile(option('--env-file')));
  if (option('--user')) {
    const child = spawnSync('runuser', ['-u', option('--user'), '--', process.execPath, __filename, ...args.filter((arg, index) => !['--env-file','--user'].includes(arg) && !['--env-file','--user'].includes(args[index - 1]))], { env: process.env, stdio: 'inherit' });
    if (child.error) throw new Error('Dienstbenutzer konnte nicht geprüft werden.'); return child.status ?? 1;
  }
  const root = path.join(__dirname, '..'), data = process.env.DATA_DIR || path.join(root, 'data'), file = process.env.CONFIG_FILE || path.join(root, 'config.json');
  if (args.includes('--busy')) {
    const state = loadState(path.join(data, 'state.json'));
    if (Object.values(state.jobs).some(job => ['running','queued','cancelling'].includes(job.status))) { console.error('Update abgebrochen: Backup läuft oder wartet. Erst nach Auftragsende aktualisieren.'); return 2; }
    return 0;
  }
  const checks = checkRuntime({ data, configFile: file, port: Number(process.env.PORT ?? 3000) });
  const config = loadConfig(file, path.join(root, 'config.example.json'), process.env.APP_PASSWORD || '', { readOnly: true });
  for (const check of checks) console.log(`OK ${check.name}: ${check.message}`);
  console.log(`OK Konfiguration: Schema ${config.schemaVersion}, ${config.sources.length} Quellen, ${config.timezone}`);
  try { execFileSync('proxmox-backup-client', ['version'], { timeout: 5000, stdio: 'pipe' }); console.log('OK Proxmox Backup Client ausführbar.'); }
  catch { if (args.includes('--require-client')) throw new Error('Proxmox Backup Client fehlt oder ist nicht ausführbar.'); console.log('HINWEIS Backup Client fehlt; produktive Backups sind nicht möglich.'); }
  return 0;
}
try { process.exitCode = main(); } catch (error) { console.error(`Prüfung fehlgeschlagen: ${error.message}`); process.exitCode = 1; }
