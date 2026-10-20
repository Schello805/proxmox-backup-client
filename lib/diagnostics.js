'use strict';
const { scheduleWindow } = require('./planning');
const { targetsFor } = require('./targets');
function createDiagnostics({ getConfig, system, inspectPath, pbs, storageChecks }) {
  let report = { running: false, checkedAt: null, checks: [] };
  function start() {
    if (report.running) return current();
    const config = getConfig();
    report = { running: true, startedAt: new Date().toISOString(), checkedAt: null, checks: [] };
    const add = (name, status, message) => report.checks.push({ name, status, message });
    void (async () => {
      try {
        const runtime = await system.inspect(true);
        try { for (const check of storageChecks()) add(check.name, check.ok ? 'ok' : 'error', check.message); }
        catch { add('Datenspeicher', 'error', 'Konfiguration oder Status nicht beschreibbar. Rechte des Dienstbenutzers prüfen.'); }
        for (const check of runtime.checks.filter(check => !['Node.js','Datenspeicher'].includes(check.name))) add(check.name, check.ok ? 'ok' : 'error', check.message);
        // Probing directory access is deliberately shallow; no recursive NAS scan.
        let index = 0;
        const worker = async () => {
          while (index < config.sources.length) {
            const source = config.sources[index++];
            try {
              const check = await inspectPath(source.path, source.expectedSource);
              add(source.name + ' · Mount & Leserechte', !check.ok ? 'error' : check.identityConfirmed ? 'ok' : 'warning', !check.ok ? check.error + ' Bind-Mount und Rechte im LXC prüfen.' : check.identityConfirmed ? 'SMB-Quelle bestätigt; Verzeichnis lässt sich öffnen.' : 'Verzeichnis lesbar. SMB-Quelle unter „Quellen“ bestätigen.');
            } catch { add(source.name + ' · Mount & Leserechte', 'error', 'Prüfung fehlgeschlagen. Bind-Mount und Rechte prüfen.'); }
          }
        };
        const connection = async () => {
          if (!config.repository || !config.password) { add('PBS-Verbindung', 'error', 'PBS-Zugang in den Einstellungen vervollständigen.'); return; }
          for (const target of targetsFor(config)) {
            const name = target.id === 'primary' ? 'PBS-Verbindung' : 'PBS-Verbindung · ' + target.name;
            try { const result = await pbs.connection(target.id); add(name, result.ok ? 'ok' : 'error', target.name + ': ' + result.message); }
            catch { add(name, 'error', 'PBS-Verbindung fehlgeschlagen. Datastore-Rechte und Netzwerk prüfen.'); }
          }
        };
        await Promise.all([worker(), worker(), worker(), connection()]);
        for (const source of config.sources) {
          const schedule = config.schedules[source.id];
          try {
            const next = scheduleWindow(schedule, config.timezone).nextAt;
            add(source.name + ' · Zeitplan', next ? 'ok' : 'warning', next ? `Nächster Termin: ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: config.timezone }).format(new Date(next))} (${config.timezone}).` : 'Nur manuelle Sicherung. Bei Bedarf einen Wochenplan hinterlegen.');
          } catch { add(source.name + ' · Zeitplan', 'error', 'Zeitzone oder Wochenplan in den Einstellungen prüfen.'); }
        }
      } catch { add('Systemdiagnose', 'error', 'Diagnose konnte nicht abgeschlossen werden. Dienstprotokoll prüfen.'); }
      finally { report.running = false; report.checkedAt = new Date().toISOString(); }
    })();
    return current();
  }
  function current() { return { ...report, checks: [...report.checks] }; }
  return { start, current };
}
module.exports = { createDiagnostics };
