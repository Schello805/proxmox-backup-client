'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { version } = require('../package.json');
function createSystem({ run, getConfig, storageChecks }) {
  let cached;
  async function inspect(fresh = false) {
    if (fresh) cached = null;
    if (!cached) cached = (async () => {
      let client = 'Nicht verfügbar', platform = os.release();
      const checks = [...storageChecks];
      try { client = (await run('proxmox-backup-client', ['version'], { timeout: 5000 })).stdout.trim(); checks.push({ ok: true, name: 'Backup Client', message: client }); }
      catch { checks.push({ ok: false, name: 'Backup Client', message: 'Client fehlt oder konnte nicht gestartet werden. Backups sind nicht möglich.' }); }
      try { platform = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || platform; } catch {}
      checks.push({ ok: process.platform === 'linux', name: 'Mount-Prüfung', message: process.platform === 'linux' ? 'Linux-Mountinfo wird für jede Quelle geprüft.' : 'Für den produktiven Backup-Betrieb wird Linux benötigt.' });
      return { hostname: os.hostname(), platform, client, version, node: process.version, checks };
    })();
    const result = await cached, config = getConfig();
    return { ...result, checks: [...result.checks, { ok: Boolean(config.repository && config.password), name: 'PBS-Zugang', message: config.repository && config.password ? 'Zugang hinterlegt; Verbindung separat prüfen.' : 'PBS-Zugang noch nicht vollständig eingerichtet.' }], timezone: config.timezone };
  }
  return { inspect };
}
module.exports = { createSystem };
