export function installControls({ api, element, refresh, refreshActivity, notice, date, getNames, onRestored }) {
  const $ = selector => document.querySelector(selector);
  let policyDirty = false, policyStamp = 0, queueSignature = '', restoreFile = null, restorePreview = null;
  const policyForm = $('#policyForm');
  for (const event of ['input','change']) policyForm.addEventListener(event, () => { policyDirty = true; policyStamp++; });
  policyForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = policyForm.querySelector('button'), stamp = policyStamp; button.disabled = true;
    try {
      await api('/api/backup-policy', { windowEnabled: policyForm.elements.windowEnabled.checked, start: policyForm.elements.start.value, end: policyForm.elements.end.value, rateMiB: Number(policyForm.elements.rateMiB.value), driveRateMiB: Number(policyForm.elements.driveRateMiB.value) });
      if (policyStamp === stamp) policyDirty = false;
      $('#policyResult').textContent = 'Gespeichert. Gilt für den nächsten Start; laufende Backups werden fertiggestellt.'; await refresh();
    } catch(e) { $('#policyResult').textContent = e.message; } finally { button.disabled = false; }
  });
  async function queueAction(action, id, direction) {
    try { await api(action === 'remove' ? `/api/backup/${id}/cancel` : '/api/queue', action === 'remove' ? {} : { action, id, direction }); await refreshActivity(); }
    catch(e) { notice(e.message, true); }
  }
  let paused = false, active = null;
  $('#pauseQueue').addEventListener('click', () => queueAction(paused ? 'resume' : 'pause'));
  function activity(data) {
    paused = data.paused; active = data.active;
    $('#pauseQueue').textContent = paused ? 'Fortsetzen' : active ? 'Nach diesem Backup pausieren' : 'Warteschlange pausieren';
    $('#queueSummary').textContent = `Warteschlange · ${data.queue.length} wartend${data.waitingReason === 'cloud' ? ' · wartet auf Google Drive' : paused ? ' · pausiert' : data.queue.length && data.waitingReason === 'window' ? ' · wartet auf Startfenster' : ''}`;
    $('#queueHelp').textContent = paused ? 'Neue Aufträge warten auf „Fortsetzen“. Ein laufendes Backup wird fertiggestellt. Die Pause bleibt beim Neustart erhalten.' : 'Wartende Aufträge verschieben oder entfernen. Der laufende Auftrag bleibt unverändert.';
    if (!active && (paused || data.queue.length && data.waitingReason === 'window')) {
      $('#activityTitle').textContent = paused ? 'Warteschlange pausiert' : 'Wartet auf Startfenster';
      $('#activityBadge').textContent = paused ? 'Pausiert' : 'Wartet'; $('#activityBadge').className = 'badge busy';
      $('#activityDescription').textContent = paused ? 'Mit „Fortsetzen“ wartende Sicherungen freigeben.' : `Neue Backups starten zwischen ${data.backupPolicy.start} und ${data.backupPolicy.end} (${data.timezone}).`;
    }
    const signature = JSON.stringify([data.queue, data.active, data.paused, data.waitingReason, getNames()]);
    if (signature === queueSignature) return; queueSignature = signature;
    const list = $('#queueList'); list.replaceChildren();
    if (!data.queue.length) list.append(element('li', 'Keine wartenden Aufträge.', 'hint'));
    data.queue.forEach((id, index) => {
      const row = element('li', undefined, 'queue-row'), name = getNames()[id] || id, actions = element('div', undefined, 'actions'); row.dataset.queueSource = id; row.append(element('strong', `${index + 1}. ${name}`));
      for (const [label, direction, disabled] of [['Nach oben', 'up', index === 0], ['Nach unten', 'down', index === data.queue.length - 1], ['Entfernen', null, false]]) {
        const button = element('button', label, 'row-action'); button.type = 'button'; button.disabled = disabled; button.setAttribute('aria-label', `${name}: ${label}`); button.addEventListener('click', () => queueAction(direction ? 'move' : 'remove', id, direction)); actions.append(button);
      }
      row.append(actions); list.append(row);
    });
  }
  $('#exportSettings').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await api('/api/config/export', { includeSecrets: $('#exportSecrets').checked });
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'backup-control-einstellungen.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#restoreResult').textContent = result.includesSecrets ? 'Export enthält Zugangsdaten im Klartext. Datei sicher verwahren.' : 'Einstellungen ohne Zugangsdaten exportiert.';
    } catch(e) { $('#restoreResult').textContent = e.message; } finally { button.disabled = false; }
  });
  function resetPreview() { restorePreview = null; $('#applyRestore').hidden = true; $('#restorePreview').replaceChildren(); }
  $('#restoreFile').addEventListener('change', () => { restoreFile = null; resetPreview(); $('#restoreResult').textContent = ''; });
  $('#previewRestore').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; resetPreview();
    try {
      const file = $('#restoreFile').files[0]; if (!file) throw Error('Zuerst eine Einstellungsdatei auswählen.'); if (file.size > 60000) throw Error('Einstellungsdatei ist zu groß (max. 60 KB).');
      restoreFile = JSON.parse(await file.text()); const result = await api('/api/config/restore/preview', { backup: restoreFile }); restorePreview = result;
      $('#restorePreview').append(element('p', `${result.sources} Daten · ${result.timezone} · ${result.includesSecrets ? 'Datei enthält Zugangsdaten' : 'Datei ohne Zugangsdaten'}`), element('p', result.changes.length ? 'Wird geändert: ' + result.changes.join(', ') : 'Keine Änderungen an den Einstellungen.'), ...result.warnings.map(warning => element('p', warning, 'hint')));
      $('#restoreResult').textContent = 'Vorschau geprüft. Erst „Wiederherstellen“ übernimmt die Einstellungen. App-Anmeldung und Backup-Verlauf bleiben erhalten.'; $('#applyRestore').hidden = false;
    } catch(e) { $('#restoreResult').textContent = e instanceof SyntaxError ? 'Datei enthält kein gültiges JSON.' : e.message; } finally { button.disabled = false; }
  });
  $('#applyRestore').addEventListener('click', async event => {
    if (!restorePreview) return; const button = event.currentTarget; button.disabled = true;
    try { const result = await api('/api/config/restore/apply', { backup: restoreFile, revision: restorePreview.revision }); resetPreview(); policyDirty = false; onRestored(); await refresh(); $('#restoreResult').textContent = `Wiederhergestellt. Vorheriger Stand gesichert: ${result.backupFile}. Daten und PBS-Zugänge prüfen.`; }
    catch(e) { $('#restoreResult').textContent = e.message; } finally { button.disabled = false; }
  });
  const bytes = value => value == null ? '—' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value / 1024**3) + ' GiB';
  function comparison(data) {
    const root = $('#historyMetrics'); root.replaceChildren();
    if (!data?.latest) { root.append(element('p', 'Noch kein erfolgreicher Lauf am aktuellen Ziel für den Vergleich.', 'hint')); return; }
    root.append(element('h3', 'Letzter erfolgreicher Lauf · ' + date(data.latest.endedAt)));
    const cards = element('div', undefined, 'run-metrics');
    for (const [key, label] of [['durationSeconds','Dauer'],['processedBytes','Verarbeitet'],['uploadedBytes','Upload (Client)']]) {
      const value = data.latest[key], change = data.changes[key], card = element('div');
      card.append(element('small', label), element('strong', key === 'durationSeconds' ? value === null ? '—' : `${Math.floor(value / 60)} min ${Math.round(value % 60)} s` : bytes(value)), element('small', change?.percent != null ? `${change.percent > 0 ? '+' : ''}${change.percent} % zum vorherigen erfolgreichen Lauf` : 'Noch kein vergleichbarer Messwert'));
      cards.append(card);
    }
    root.append(cards, element('p', 'Verglichen werden erfolgreiche Läufe mit demselben Pfad, PBS-Ziel und Namespace. Verarbeitung und Upload sind Client-Messwerte, keine Liste geänderter Dateien.', 'hint'));
  }
  return { activity, comparison, update(data) {
    if (!policyDirty) { const policy = data.config.backupPolicy; policyForm.elements.windowEnabled.checked = policy.windowEnabled; policyForm.elements.start.value = policy.start; policyForm.elements.end.value = policy.end; policyForm.elements.rateMiB.value = policy.rateMiB; policyForm.elements.driveRateMiB.value = policy.driveRateMiB; }
    $('#policyTimezone').textContent = data.config.timezone;
  } };
}
