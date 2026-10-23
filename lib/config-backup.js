'use strict';
const crypto = require('node:crypto');
const { validateConfig } = require('./validation');
const { SCHEMA_VERSION } = require('./storage');
const revision = config => crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
function exportConfig(config, includeSecrets = false) {
  if (typeof includeSecrets !== 'boolean') throw new Error('Zugangsdaten-Auswahl muss ein- oder ausgeschaltet sein.');
  const copy = structuredClone(config);
  if (!includeSecrets) { copy.password = ''; if(copy.secondaryPBS) copy.secondaryPBS.password = ''; copy.notifications.token = ''; }
  return { format: 'qnap-backup-settings', version: 1, createdAt: new Date().toISOString(), includesSecrets: includeSecrets, config: copy };
}
function previewRestore(backup, current) {
  if (!backup || backup.format !== 'qnap-backup-settings' || backup.version !== 1 || !backup.config || ![1,2,3,4,SCHEMA_VERSION].includes(backup.config.schemaVersion)) throw new Error('Keine unterstützte Backup-Control-Einstellungsdatei.');
  const raw = structuredClone(backup.config);
  const base = structuredClone(current);
  if (raw.repository !== current.repository) base.password = '';
  // Validation preserves secrets only for matching identities; app login stays local.
  raw.authEnabled = current.authEnabled;
  const candidate = { ...validateConfig(raw, base), schemaVersion: SCHEMA_VERSION };
  const changes = [];
  for (const [key,label] of [['additionalDatastores','Zusätzliche PBS-Datastores'],['gdrive','Google Drive'],['sources','Quellen'],['schedules','Wochenpläne'],['repository','PBS 1'],['secondaryDatastore','Datastore 2'],['secondaryPBS','PBS 2'],['password','PBS-1-Zugang'],['fingerprint','Fingerprint PBS 1'],['namespace','Namespace'],['timezone','Zeitzone'],['staleAfterDays','Warnschwelle'],['capacityWarnPercent','Speicherwarnung'],['backupPolicy','Startfenster / Bandbreite'],['notifications','Benachrichtigungen']]) if (JSON.stringify(candidate[key]) !== JSON.stringify(current[key])) changes.push(label);
  const warnings = [];
  if (candidate.gdrive.mode === 'sync') warnings.push('Google Drive: Synchronisierung entfernt zusätzliche Dateien in den Quell-Zielordnern.');
  if (candidate.gdrive.sources.length) warnings.push('Google Drive: rclone.conf wird separat gesichert; Google-Anmeldung im LXC prüfen.');
  if (candidate.repository && !candidate.password) warnings.push('PBS 1: Zugangsdaten nachtragen.');
  if (candidate.secondaryPBS && !candidate.secondaryPBS.password) warnings.push('PBS 2: Zugangsdaten nachtragen.');
  if (candidate.notifications.enabled && !candidate.notifications.token) warnings.push('ntfy ohne Token: bei geschütztem Topic Token nachtragen.');
  return { candidate, summary: { changes, warnings, sources: candidate.sources.length, timezone: candidate.timezone, includesSecrets: Boolean(raw.password || raw.secondaryPBS?.password || raw.notifications?.token), revision: revision(current) } };
}
module.exports = { exportConfig, previewRestore, revision };
