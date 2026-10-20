'use strict';
const https = require('node:https');
const { version } = require('../package.json');
const repository = 'https://github.com/Schello805/proxmox-backup-client';
const api = 'https://api.github.com/repos/Schello805/proxmox-backup-client';
function requestJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'QNAP-Backup-Control', Accept: 'application/vnd.github+json' } }, res => {
      let text = '', length = 0;
      res.on('data', chunk => { length += chunk.length; if (length > 512 * 1024) { req.destroy(new Error('Antwort zu groß.')); return; } text += chunk; });
      res.on('error', reject);
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error('GitHub nicht verfügbar.')); try { resolve(JSON.parse(text)); } catch { reject(new Error('Ungültige Antwort.')); } });
    });
    const timer = setTimeout(() => req.destroy(new Error('Zeitlimit überschritten.')), 6000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}
function createUpdates({ run, root, fetchJSON = requestJSON, now = Date.now }) {
  let installedRequest, checking, last = null, lastAt = 0;
  function installed() {
    return installedRequest ||= (async () => {
      try {
        const options = { cwd: root, timeout: 3000, maxBuffer: 65536, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
        const args = ['-c', `safe.directory=${root}`];
        const { stdout } = await run('git', [...args, 'rev-parse', 'HEAD'], options);
        const commit = stdout.trim();
        if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Unbekannter Git-Stand.');
        const status = await run('git', [...args, 'status', '--porcelain', '--untracked-files=no'], options);
        return { version, commit, modified: Boolean(status.stdout.trim()), repository };
      } catch { return { version, commit: null, modified: null, repository }; }
    })();
  }
  async function check() {
    if (checking) return checking;
    if (last && now() - lastAt < 60_000) return last;
    checking = (async () => {
      const local = await installed();
      const result = { installed: local, checkedAt: new Date(now()).toISOString(), status: 'unknown', latest: null };
      try {
        const ref = await fetchJSON(api + '/git/ref/heads/main');
        const commit = ref?.object?.sha;
        if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Ungültiger Git-Stand.');
        const pkg = await fetchJSON(`https://raw.githubusercontent.com/Schello805/proxmox-backup-client/${commit}/package.json`);
        if (!/^\d+\.\d+\.\d+$/.test(pkg?.version)) throw new Error('Ungültige Version.');
        result.latest = { version: pkg.version, commit, url: repository + '/commit/' + commit };
        if (local.commit === commit) result.status = local.modified ? 'modified' : 'current';
        else if (local.commit) {
          const comparison = await fetchJSON(`${api}/compare/${local.commit}...${commit}?per_page=1`);
          result.status = ({ ahead: 'available', behind: 'local-newer', diverged: 'diverged', identical: 'current' })[comparison.status] || 'unknown';
          if (local.modified) result.status = 'modified';
        }
        result.message = ({ current: 'Du verwendest den aktuellen Stand von main.', available: 'Ein neuer Stand ist verfügbar.', 'local-newer': 'Dein lokaler Stand ist neuer als main.', diverged: 'Lokaler Stand und main sind auseinander gelaufen. Vor dem Update prüfen.', modified: 'Lokale Änderungen vorhanden. Vor dem Update prüfen.', unknown: 'Git-Stand konnte nicht eindeutig verglichen werden.' })[result.status];
      } catch {
        result.status = 'error'; result.message = 'Update-Prüfung fehlgeschlagen. Internetzugang oder GitHub-Limit prüfen und später erneut versuchen.';
      }
      last = result; lastAt = now(); return result;
    })().finally(() => { checking = null; });
    return checking;
  }
  return { installed, check, current: () => last };
}
module.exports = { createUpdates };
