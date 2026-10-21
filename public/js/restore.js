export function installRestore({ api, element, date, showContext }) {
  const $ = selector => document.querySelector(selector);
  let sourceId = null, info = null, epoch = 0;
  function selection() {
    const selected = info?.snapshots.find(snapshot => snapshot.snapshot === $('#restoreSnapshot').value);
    $('#copyRestoreSnapshot').disabled = !selected;
    $('#restoreSelection').replaceChildren();
    if (!selected) { $('#restoreSelection').textContent = 'Noch kein Snapshot dieser Backup-Gruppe im abgerufenen Bestand. Bestand vom PBS abrufen oder im PBS prüfen.'; return; }
    $('#restoreSelection').append(element('code', selected.snapshot), element('span', ` · Archiv: ${info.archive}`));
    if (!selected.archivePresent) $('#restoreSelection').append(element('strong', ' · Erwartetes Archiv nicht in der Dateiliste: im PBS das tatsächlich gesicherte pxar-Archiv prüfen.'));
  }
  function render(next) {
    const previous = $('#restoreSnapshot').value; info = next;
    $('#restoreInfo').textContent = `Ziel der Quelle: ${info.datastore || 'noch nicht eingerichtet'} · Namespace: ${info.namespace || 'Root'} · Gruppe: ${info.group}${info.checkedAt ? ' · Bestand: ' + date(info.checkedAt) : ' · Bestand noch nicht abgerufen'}${!info.hasPassword ? ' · App-Zugang fehlt: bei Bedarf im PBS separat anmelden' : ''}${info.error ? ' · ' + info.error + ' (ggf. alter Bestand)' : ''}`;
    const link = $('#openRestorePBS'); link.hidden = !info.url; if (info.url) link.href = info.url; else link.removeAttribute('href');
    $('#restoreSnapshot').replaceChildren(...info.snapshots.map(snapshot => { const option = element('option', `${date(snapshot.time)} · ${snapshot.snapshot}`); option.value = snapshot.snapshot; return option; }));
    if (info.snapshots.some(snapshot => snapshot.snapshot === previous)) $('#restoreSnapshot').value = previous;
    $('#restoreSnapshot').disabled = !info.snapshots.length; selection();
  }
  async function open(id, fresh = false) {
    sourceId = id; const token = ++epoch; showContext('restorePanel', id);
    info = null; $('#restoreTitle').textContent = 'Wiederherstellung prüfen'; $('#restoreInfo').textContent = 'Bestand wird geladen …'; $('#restoreFeedback').textContent = '';
    $('#openRestorePBS').hidden = true; $('#copyRestoreSnapshot').disabled = true; $('#restoreSnapshot').disabled = true; $('#refreshRestore').disabled = true; $('#restoreSelection').replaceChildren();
    try { const result = await api(`/api/restore/${id}${fresh ? '/refresh' : ''}`, fresh ? {} : undefined); if (token !== epoch) return; render(result); }
    catch(e) { if (token === epoch) { $('#restoreInfo').textContent = 'Bestand konnte nicht geladen werden.'; $('#restoreFeedback').textContent = e.message; } }
    finally { if (token === epoch) $('#refreshRestore').disabled = false; }
  }
  $('#refreshRestore').addEventListener('click', () => { if (sourceId) void open(sourceId, true); });
  $('#restoreSnapshot').addEventListener('change', selection);
  $('#copyRestoreSnapshot').addEventListener('click', async () => {
    const text = $('#restoreSnapshot').value; if (!text) return;
    try {
      try { if (!navigator.clipboard) throw Error(); await navigator.clipboard.writeText(text); }
      catch { const field = document.createElement('textarea'); field.value = text; field.className = 'copy-buffer'; document.body.append(field); field.select(); const copied = document.execCommand('copy'); field.remove(); if (!copied) throw Error(); }
      $('#restoreFeedback').textContent = 'Snapshot-Bezeichnung kopiert.';
    } catch { $('#restoreFeedback').textContent = 'Bitte die angezeigte Snapshot-Bezeichnung markieren und kopieren.'; }
  });
  return { open };
}
