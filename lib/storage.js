'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateConfig } = require('./validation');
const SCHEMA_VERSION = 4;
function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`Ungültige JSON-Datei: ${file}. Original bleibt erhalten; Sicherung wiederherstellen oder Datei korrigieren.`); }
}
function saveJSON(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(temp, 0o600); fs.renameSync(temp, file);
  } catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
}
function migrateConfig(input, password = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Konfiguration muss ein JSON-Objekt sein.');
  const version = input.schemaVersion ?? 1;
  if (![1, 2, 3, SCHEMA_VERSION].includes(version)) throw new Error(`Konfigurationsversion ${version} wird nicht unterstützt. Passende App-Version verwenden.`);
  const config = validateConfig({ ...input, authEnabled: input.authEnabled ?? Boolean(password) }, { password: '' });
  if (config.authEnabled && password.length < 6) throw new Error('Für aktivierten Passwortschutz APP_PASSWORD mit mindestens 6 Zeichen setzen oder authEnabled in config.json deaktivieren.');
  return { ...config, schemaVersion: SCHEMA_VERSION };
}
function loadConfig(file, defaults, password, { readOnly = false } = {}) {
  const exists = fs.existsSync(file), text = exists ? fs.readFileSync(file, 'utf8') : '';
  const input = exists && text.trim() ? readJSON(file) : readJSON(defaults);
  const config = migrateConfig(input, password);
  if (!readOnly && (!exists || !text.trim() || input.schemaVersion !== SCHEMA_VERSION)) {
    if (exists && text.trim()) {
      const backup = `${file}.pre-v${SCHEMA_VERSION}-${Date.now()}.json`;
      fs.writeFileSync(backup, text, { flag: 'wx', mode: 0o600 });
    }
    saveJSON(file, config);
  }
  return config;
}
function loadState(file) {
  const state = readJSON(file, {});
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Statusdatei muss ein JSON-Objekt sein.');
  for (const key of ['jobs', 'triggered', 'history', 'watchSince', 'alerted']) {
    state[key] ??= {};
    if (typeof state[key] !== 'object' || state[key] === null || Array.isArray(state[key])) throw new Error(`Ungültiger Bereich in Statusdatei: ${key}`);
  }
  return state;
}
function checkRuntime({ data, configFile, port }) {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node.js ab Version 18 wird benötigt.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT muss eine Zahl zwischen 0 und 65535 sein.');
  try { fs.accessSync(data, fs.constants.R_OK | fs.constants.W_OK); } catch { throw new Error(`Datenverzeichnis fehlt oder ist nicht les-/beschreibbar: ${data}`); }
  try { fs.accessSync(path.dirname(configFile), fs.constants.W_OK); } catch { throw new Error(`Konfigurationsverzeichnis ist nicht beschreibbar: ${path.dirname(configFile)}`); }
  return [{ ok: true, name: 'Node.js', message: process.version }, { ok: true, name: 'Datenspeicher', message: 'Konfiguration und Status beschreibbar.' }];
}
function acquireLock(data) {
  const file = path.join(data, '.instance-lock'), token = `${process.pid}:${Date.now()}:${Math.random()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, token, { flag: 'wx', mode: 0o600 });
      return () => { try { if (fs.readFileSync(file, 'utf8') === token) fs.unlinkSync(file); } catch {} };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = fs.readFileSync(file, 'utf8'), pid = Number(existing.split(':')[0]);
      if (!Number.isInteger(pid) || pid < 1) throw new Error('Ungültige Instanz-Sperrdatei. Laufende Dienste prüfen.');
      try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') { fs.unlinkSync(file); continue; } }
      throw new Error('Eine App-Instanz verwendet dieses Datenverzeichnis bereits. Vor einem manuellen Start den Dienst stoppen.');
    }
  }
  throw new Error('Datenverzeichnis konnte nicht exklusiv geöffnet werden.');
}
module.exports = { SCHEMA_VERSION, readJSON, saveJSON, migrateConfig, loadConfig, loadState, checkRuntime, acquireLock };
