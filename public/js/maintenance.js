export function installMaintenance({ api, element, date, isAuthenticated, getEpoch }) {
const $ = selector => document.querySelector(selector);
let diagnosticTimer, diagnosticPolling = false, versionChecking = false, lastVersionAttempt = 0;
function showDiagnostics(report) {
  const errors = report.checks.filter(check => check.status === 'error').length, warnings = report.checks.filter(check => check.status === 'warning').length;
  $('#diagnosticSummary').textContent = report.running ? `Prüfung läuft … ${report.checks.length} Ergebnisse vorhanden.` : report.checkedAt ? `${errors} Fehler · ${warnings} Hinweise · geprüft ${date(report.checkedAt)}` : 'Mounts, Verzeichniszugriff, PBS und Zeitpläne mit einem Klick prüfen.';
  $('#runDiagnostics').disabled = report.running;
  if (report.running && !$('#settings').hidden) { clearTimeout(diagnosticTimer); diagnosticTimer = setTimeout(pollDiagnostics, 1500); }
}
async function pollDiagnostics() {
  if (!isAuthenticated() || $('#settings').hidden || diagnosticPolling) return;
  diagnosticPolling = true; const epoch = getEpoch();
  try { const report = await api('/api/diagnostics'); if (epoch === getEpoch()) showDiagnostics(report); }
  catch (e) { $('#diagnosticSummary').textContent = e.message; $('#runDiagnostics').disabled = false; }
  finally { diagnosticPolling = false; }
}
function showVersionStatus(result) {
  const badge = $('#versionUpdate');
  const labels = {current:'Aktuell',available:'Update verfügbar','local-newer':'Lokaler Stand neuer',modified:'Lokale Änderungen',diverged:'Stand prüfen',unknown:'Stand unbekannt',error:'Prüfung fehlgeschlagen'};
  badge.textContent = result ? labels[result.status] || 'Stand unbekannt' : 'Noch nicht geprüft';
  badge.dataset.status = result?.status || 'unknown';
  badge.title = result ? `${result.message} · geprüft ${date(result.checkedAt)}` : 'Update-Status unter Einstellungen prüfen.';
}
async function checkVersionStatus() {
  if (!isAuthenticated() || versionChecking || Date.now() - lastVersionAttempt < 60 * 60 * 1000) return;
  versionChecking = true; lastVersionAttempt = Date.now(); const epoch = getEpoch();
  $('#versionUpdate').textContent = 'Prüfe Updates …';
  try { const result = await api('/api/updates/check', {}); if (epoch === getEpoch()) showUpdate(result); }
  catch { if (epoch === getEpoch()) showVersionStatus({status:'error',message:'Update-Prüfung nicht erreichbar.',checkedAt:new Date().toISOString()}); }
  finally { versionChecking = false; }
}
document.addEventListener('check-version-status', checkVersionStatus);
$('#versionUpdate').addEventListener('click', () => { $('#systemMaintenance').open = true; document.dispatchEvent(new Event('open-system')); });
function showUpdate(result) {
  showVersionStatus(result);
  $('#updateResult').textContent = result ? `${result.message} · geprüft ${date(result.checkedAt)}` : 'Noch nicht geprüft.';
  $('#latestVersionLink').hidden = !result?.latest;
  if (result?.latest) { $('#latestVersionLink').href = result.latest.url; $('#latestVersionLink').textContent = `GitHub: v${result.latest.version} · ${result.latest.commit.slice(0, 7)} ↗`; }
}
async function openSystem() {
  if (!isAuthenticated()) return;
  const epoch = getEpoch();
  $('#installedVersion').textContent = 'Installierte Version wird geladen …';
  await Promise.allSettled([pollDiagnostics(), (async () => {
    try { const data = await api('/api/updates'); if (epoch !== getEpoch()) return; $('#installedVersion').textContent = `Installiert: v${data.installed.version} · ${data.installed.commit ? data.installed.commit.slice(0, 7) : 'Git-Stand unbekannt'}${data.installed.modified ? ' · lokale Änderungen' : ''}`; showUpdate(data.result); }
    catch (e) { $('#installedVersion').textContent = e.message; }
  })()]);
}
document.addEventListener('open-system', openSystem);
$('#runDiagnostics').addEventListener('click', async () => {
  $('#runDiagnostics').disabled = true; $('#diagnosticSummary').textContent = 'Prüfung wird gestartet …'; const epoch = getEpoch();
  try { const report = await api('/api/diagnostics', {}); if (epoch === getEpoch()) showDiagnostics(report); }
  catch (e) { $('#diagnosticSummary').textContent = e.message; $('#runDiagnostics').disabled = false; }
});
$('#checkUpdates').addEventListener('click', async () => {
  lastVersionAttempt = Date.now(); $('#versionUpdate').textContent = 'Prüfe Updates …';
  $('#checkUpdates').disabled = true; $('#updateResult').textContent = 'Vergleiche installierten Stand mit GitHub …'; const epoch = getEpoch();
  try { const result = await api('/api/updates/check', {}); if (epoch === getEpoch()) showUpdate(result); }
  catch (e) { $('#updateResult').textContent = e.message; showVersionStatus({status:'error',message:e.message,checkedAt:new Date().toISOString()}); }
  finally { $('#checkUpdates').disabled = false; }
});
}
