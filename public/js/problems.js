export function sourceProblem(folder, job = folder.job || {}, health = folder.health || {}, target = {}, connection) {
  if(folder.partitioned)return null;
  const actual = folder.mount?.source, expected = folder.expectedSource;
  if (actual && expected && actual !== expected && ['cifs','smb3','nfs','nfs4'].includes(folder.mount?.type)) {
    const name = value => value.split('/').filter(Boolean).at(-1);
    const sameName = name(actual) === name(expected);
    return { kind: 'mount', message: `${folder.name} zeigt auf „${sameName ? actual : name(actual)}“ statt „${sameName ? expected : name(expected)}“.`, action: 'Zuordnung prüfen', view: 'source', help: 'Die Bind-Mount-Zuordnung am Proxmox-Host prüfen. Die erwartete Freigabe nur ändern, wenn der Wechsel beabsichtigt ist.' };
  }
  if (folder.checking && !folder.checkedAt) return null;
  if (!folder.ok) return { kind: 'mount', message: !folder.mount ? `${folder.name} ist nicht erreichbar oder nicht lesbar.` : ['cifs','smb3','nfs','nfs4'].includes(folder.mount.type) ? `${folder.name} ist nicht lesbar.` : `${folder.name} ist im LXC nicht als Netzwerkfreigabe eingebunden.`, action: 'Mount prüfen', view: 'source', help: 'Mount am Host und Durchreichung in den LXC prüfen. Danach Leserechte des Dienstbenutzers qnap-backup kontrollieren.' };
  if (!folder.targetRepository || target.hasPassword === false) return { kind: 'target', message: 'Das Backup-Ziel ist noch nicht vollständig eingerichtet.', action: 'Backup-Ziel einrichten', view: 'targets', help: 'PBS-Adresse, Datastore und Zugang unter Backup-Ziele speichern.' };
  if (connection?.ok === false) return { kind: 'target', message: 'Das PBS-Ziel konnte nicht erreicht oder der Zugang nicht bestätigt werden.', action: 'Backup-Ziel prüfen', view: 'targets', help: 'Adresse, Zugang, Datastore-Rechte und Fingerprint prüfen und die Verbindung erneut testen.' };
  if (job.status === 'failed') return { kind: 'job', message: 'Die letzte Sicherung ist fehlgeschlagen.', action: 'Protokoll prüfen', view: 'log', help: job.error || 'Das Protokoll enthält die Meldung des Backup Clients.' };
  if (job.status === 'interrupted') return { kind: 'job', message: 'Die letzte Sicherung wurde unterbrochen.', action: 'Erneut sichern', view: 'backup', help: 'Der Dienst wurde während des Auftrags beendet. Eine neue Sicherung manuell starten.' };
  if (health.missed || health.stale) return { kind: 'schedule', message: health.missed ? 'Der geplante Termin hat noch keine erfolgreiche Sicherung.' : 'Der letzte erfolgreiche Lauf liegt zu lange zurück.', action: 'Jetzt sichern', view: 'backup', help: 'Eine Sicherung starten. Bei wiederkehrenden Hinweisen den Wochenplan und die Dienstlaufzeit prüfen.' };
  return null;
}

// One compact, actionable state; unknown/stale checks never count as a current success.
export function sourceHealth(folder, job = {}, health = {}, target = {}, connection, capacity = {}, now = Date.now()) {
  if(folder.partitioned)return {label:'Aufgeteilt',tone:'ok',action:'Unterordner verwalten',view:'source',message:'PBS-Aufträge laufen je Unterordner. Neue Ordner unter Quellen zuordnen.'};
  const busy = ['running','queued','cancelling'].includes(job.status);
  const recent = value => Number.isFinite(Date.parse(value)) && now - Date.parse(value) >= -60000 && now - Date.parse(value) <= 20 * 60000;
  const observed = latestConnection(job, connection, capacity, folder.pbsCheckAfter);
  const issue = sourceProblem(folder, job, health, target, observed?.ok === false ? observed : undefined);
  if (folder.checking && !folder.checkedAt && !issue) return { label: 'Wird geprüft', tone: 'busy', action: 'Mount prüfen', view: 'source', message: 'Die erste Lesbarkeitsprüfung läuft noch.' };
  if (issue) {
    const label = issue.kind === 'mount' ? ['cifs','smb3','nfs','nfs4'].includes(folder.mount?.type) && folder.mount?.source && folder.expectedSource && folder.mount.source !== folder.expectedSource ? 'Mount-Zuordnung falsch' : 'Mount nicht verfügbar' : issue.kind === 'target' ? !folder.targetRepository || target.hasPassword === false ? 'PBS einrichten' : 'PBS-Zugang gestört' : issue.kind === 'schedule' ? 'Sicherung überfällig' : job.status === 'interrupted' ? 'Unterbrochen' : 'Sicherung fehlgeschlagen';
    return { ...issue, label, tone: ['mount','target','job'].includes(issue.kind) ? 'bad' : 'busy', ...(observed?.checkedAt && issue.kind === 'target' ? { checkedAt: observed.checkedAt } : {}) };
  }
  if (!folder.expectedSource) return { label: 'Mount bestätigen', tone: 'busy', action: 'Zuordnung prüfen', view: 'source', message: 'Erwartete Netzwerkfreigabe noch nicht bestätigt.' };
  if (busy) return { label: job.status === 'queued' ? 'Sicherung wartet' : job.status === 'cancelling' ? 'Wird abgebrochen' : 'Backup läuft', tone: 'busy', action: 'Protokoll öffnen', view: 'log', message: 'Auftrag dieser App.' };
  if (job.status === 'cancelled') return { label: 'Abgebrochen', tone: 'busy', action: 'Erneut sichern', view: 'backup', message: 'Die letzte Sicherung wurde auf Wunsch abgebrochen.' };
  if (!job.lastSuccess) return { label: 'Noch keine Sicherung', tone: 'busy', action: 'Jetzt sichern', view: 'backup', message: 'Noch kein erfolgreicher App-Lauf für diese Quelle am aktuellen Ziel.' };
  if (!observed || !recent(observed.checkedAt)) return { label: 'PBS erneut prüfen', tone: 'busy', action: 'PBS prüfen', view: 'connection', message: 'Keine erfolgreiche PBS-Prüfung in den letzten 20 Minuten. Der letzte Backup-Erfolg bleibt unten separat dokumentiert.', checkedAt: observed?.checkedAt };
  return { label: 'Alles aktuell', tone: 'ok', action: 'Wiederherstellung prüfen', view: 'restore', message: 'Netzwerkfreigabe lesbar, PBS zuletzt erreichbar und keine überfällige Sicherung. Eine Wiederherstellungsprüfung erfolgt separat.', checkedAt: observed.checkedAt };
}

export function latestConnection(job = {}, connection, capacity = {}, checkAfter) {
  const observations = [];
  if (connection && Number.isFinite(Date.parse(connection.checkedAt))) observations.push(connection);
  if (capacity.error && capacity.attemptedAt) observations.push({ ok: false, checkedAt: capacity.attemptedAt, message: capacity.error });
  if (capacity.checkedAt && !capacity.error) observations.push({ ok: true, checkedAt: capacity.checkedAt });
  if (job.status === 'running' && job.progress?.uploadedBytes > 0) observations.push({ ok: true, checkedAt: job.progress.updatedAt });
  if (job.status === 'success' && job.lastSuccess) observations.push({ ok: true, checkedAt: job.lastSuccess });
  return connection && !connection.checkedAt ? connection : observations.filter(value => Number.isFinite(Date.parse(value.checkedAt)) && Date.parse(value.checkedAt) >= (Date.parse(checkAfter || '') || 0)).sort((a,b) => Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0];
}
