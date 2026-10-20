export function sourceProblem(folder, job = folder.job || {}, health = folder.health || {}, target = {}, connection) {
  const actual = folder.mount?.source, expected = folder.expectedSource;
  if (actual && expected && actual !== expected && ['cifs','smb3'].includes(folder.mount?.type)) {
    const name = value => value.split('/').filter(Boolean).at(-1);
    const sameName = name(actual) === name(expected);
    return { kind: 'mount', message: `${folder.name} zeigt auf „${sameName ? actual : name(actual)}“ statt „${sameName ? expected : name(expected)}“.`, action: 'Zuordnung prüfen', view: 'source', help: 'Die Bind-Mount-Zuordnung am Proxmox-Host prüfen. Die erwartete Freigabe nur ändern, wenn der Wechsel beabsichtigt ist.' };
  }
  if (!folder.ok) return { kind: 'mount', message: !folder.mount ? `${folder.name} ist nicht erreichbar oder nicht lesbar.` : ['cifs','smb3'].includes(folder.mount.type) ? `${folder.name} ist nicht lesbar.` : `${folder.name} ist im LXC nicht als SMB-Freigabe eingebunden.`, action: 'Mount prüfen', view: 'source', help: 'Mount am Host und Durchreichung in den LXC prüfen. Danach Leserechte des Dienstbenutzers qnap-backup kontrollieren.' };
  if (!folder.targetRepository || target.hasPassword === false) return { kind: 'target', message: 'Das Backup-Ziel ist noch nicht vollständig eingerichtet.', action: 'Backup-Ziel einrichten', view: 'targets', help: 'PBS-Adresse, Datastore und Zugang unter Backup-Ziele speichern.' };
  if (connection?.ok === false) return { kind: 'target', message: 'Das PBS-Ziel konnte nicht erreicht oder der Zugang nicht bestätigt werden.', action: 'Backup-Ziel prüfen', view: 'targets', help: 'Adresse, Zugang, Datastore-Rechte und Fingerprint prüfen und die Verbindung erneut testen.' };
  if (job.status === 'failed') return { kind: 'job', message: 'Die letzte Sicherung ist fehlgeschlagen.', action: 'Protokoll prüfen', view: 'log', help: job.error || 'Das Protokoll enthält die Meldung des Backup Clients.' };
  if (job.status === 'interrupted') return { kind: 'job', message: 'Die letzte Sicherung wurde unterbrochen.', action: 'Erneut sichern', view: 'backup', help: 'Der Dienst wurde während des Auftrags beendet. Eine neue Sicherung manuell starten.' };
  if (health.missed || health.stale) return { kind: 'schedule', message: health.missed ? 'Der geplante Termin hat noch keine erfolgreiche Sicherung.' : 'Der letzte erfolgreiche Lauf liegt zu lange zurück.', action: 'Jetzt sichern', view: 'backup', help: 'Eine Sicherung starten. Bei wiederkehrenden Hinweisen den Wochenplan und die Dienstlaufzeit prüfen.' };
  return null;
}
