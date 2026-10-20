export function installMaintenance({ api, element, date, isAuthenticated, getEpoch }) {
const $ = selector => document.querySelector(selector);
let diagnosticTimer, diagnosticPolling = false;
function showDiagnostics(report) {
  $('#diagnosticChecks').replaceChildren();
  for (const check of report.checks) {
    const item = element('li'), badge = element('span', check.status === 'ok' ? 'OK' : check.status === 'warning' ? 'Hinweis' : 'Fehler', `badge ${check.status === 'ok' ? 'ok' : check.status === 'warning' ? 'busy' : 'bad'}`);
    const content = element('div'); content.append(element('strong', check.name), element('small', check.message)); item.append(badge, content); $('#diagnosticChecks').append(item);
  }
  const errors = report.checks.filter(check => check.status === 'error').length, warnings = report.checks.filter(check => check.status === 'warning').length;
  $('#diagnosticSummary').textContent = report.running ? `Prüfung läuft … ${report.checks.length} Ergebnisse vorhanden.` : report.checkedAt ? `${errors} Fehler · ${warnings} Hinweise · geprüft ${date(report.checkedAt)}` : 'Mounts, Verzeichniszugriff, PBS und Zeitpläne mit einem Klick prüfen.';
  $('#runDiagnostics').disabled = report.running;
  if (report.running && $('#systemDialog').open) { clearTimeout(diagnosticTimer); diagnosticTimer = setTimeout(pollDiagnostics, 1500); }
}
async function pollDiagnostics() {
  if (!isAuthenticated() || !$('#systemDialog').open || diagnosticPolling) return;
  diagnosticPolling = true; const epoch = getEpoch();
  try { const report = await api('/api/diagnostics'); if (epoch === getEpoch()) showDiagnostics(report); }
  catch (e) { $('#diagnosticSummary').textContent = e.message; $('#runDiagnostics').disabled = false; }
  finally { diagnosticPolling = false; }
}
function showUpdate(result) {
  $('#updateResult').textContent = result ? `${result.message} · geprüft ${date(result.checkedAt)}` : 'Noch nicht geprüft.';
  $('#latestVersionLink').hidden = !result?.latest;
  if (result?.latest) { $('#latestVersionLink').href = result.latest.url; $('#latestVersionLink').textContent = `GitHub: v${result.latest.version} · ${result.latest.commit.slice(0, 7)} ↗`; }
}
async function openSystem() {
  if (!isAuthenticated()) return;
  $('#systemDialog').showModal(); const epoch = getEpoch();
  $('#installedVersion').textContent = 'Installierte Version wird geladen …';
  await Promise.allSettled([pollDiagnostics(), (async () => {
    try { const data = await api('/api/updates'); if (epoch !== getEpoch()) return; $('#installedVersion').textContent = `Installiert: v${data.installed.version} · ${data.installed.commit ? data.installed.commit.slice(0, 7) : 'Git-Stand unbekannt'}${data.installed.modified ? ' · lokale Änderungen' : ''}`; showUpdate(data.result); }
    catch (e) { $('#installedVersion').textContent = e.message; }
  })()]);
}
$('#openSystem').addEventListener('click', openSystem);
$('#appVersion').addEventListener('click', openSystem);
$('#systemDialog').addEventListener('close', () => clearTimeout(diagnosticTimer));
$('#runDiagnostics').addEventListener('click', async () => {
  $('#runDiagnostics').disabled = true; $('#diagnosticSummary').textContent = 'Prüfung wird gestartet …'; const epoch = getEpoch();
  try { const report = await api('/api/diagnostics', {}); if (epoch === getEpoch()) showDiagnostics(report); }
  catch (e) { $('#diagnosticSummary').textContent = e.message; $('#runDiagnostics').disabled = false; }
});
$('#checkUpdates').addEventListener('click', async () => {
  $('#checkUpdates').disabled = true; $('#updateResult').textContent = 'Vergleiche installierten Stand mit GitHub …'; const epoch = getEpoch();
  try { const result = await api('/api/updates/check', {}); if (epoch === getEpoch()) showUpdate(result); }
  catch (e) { $('#updateResult').textContent = e.message; }
  finally { $('#checkUpdates').disabled = false; }
});
}
