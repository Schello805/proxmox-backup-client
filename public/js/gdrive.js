export function installDrive({ api, element, notice, scheduleText, date }) {
  const $ = selector => document.querySelector(selector), form = $('#driveForm');
  let initialized = false, dirty = false, loading = false, currentJob = null, pendingAction = false;
  const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  for (let day = 1; day <= 31; day++) $('#driveMonth').append(new Option(String(day), String(day)));
  $('#driveMonth').append(new Option('Letzter Tag', 'last'));
  for (let day = 1; day <= 7; day++) { const label = element('label', dayNames[day - 1]); const input = element('input'); input.type = 'checkbox'; input.value = day; input.name = 'driveDay'; label.prepend(input); $('#driveDays').append(label); }
  function modeChanged() { $('#driveDays').hidden = form.elements.mode.value !== 'weekly'; $('#driveMonthLabel').hidden = form.elements.mode.value !== 'monthly'; form.elements.time.disabled = form.elements.mode.value === 'manual'; $('#driveSyncWarning').hidden = form.elements.transferMode.value !== 'sync'; $('#driveBackupInfo').hidden = form.elements.transferMode.value !== 'backup'; $('#driveModeHint').textContent = ({backup:'Sicherung mit Versionen: aktueller Stand plus Archiv ersetzter und entfernter Dateien.',copy:'Abgleich ohne Löschen: neue/geänderte Dateien übernehmen; zusätzliche Zieldateien behalten. Ältere überschriebene Versionen werden nicht archiviert.',sync:'Abgleich mit Löschen: Ziel entspricht der Quelle; zusätzliche Zieldateien werden entfernt.'})[form.elements.transferMode.value]; $('#driveVersionPath').textContent=(form.elements.remote.value||'gdrive')+':'+(form.elements.folder.value||'QNAP-Backup')+'.versions/<Backup-ID>/<Lauf>/'; }
  form.addEventListener('input', () => { dirty = true; modeChanged(); }); form.addEventListener('change', () => { dirty = true; modeChanged(); });
  function render(job) {
    if (!job) return;
    currentJob = job;
    const labels = { idle: 'Noch kein Lauf', queued: 'Wartet', running: 'Läuft', cancelling: 'Abbruch läuft', cancelled: 'Abgebrochen', failed: 'Fehlgeschlagen', success: 'Erfolgreich', interrupted: 'Unterbrochen' };
    $('#driveStatus').textContent = labels[job.status] || job.status;
    $('#driveMessage').textContent = job.message || 'Quellen auswählen, speichern und Verbindung prüfen.';
    $('#driveLast').textContent = job.lastSuccess ? 'Letzter Erfolg: ' + date(job.lastSuccess) : 'Noch kein erfolgreicher Lauf';
    const syncing = job.settings?.mode === 'sync', versioned = job.settings?.mode === 'backup';
    const modeLabel = versioned ? 'Sicherung mit Versionen' : syncing ? 'Abgleich mit Löschen' : 'Abgleich ohne Löschen';
    $('#driveStart').textContent = versioned ? 'Jetzt mit Versionen sichern' : syncing ? 'Jetzt synchronisieren' : 'Jetzt nach Drive kopieren';
    $('#overviewDriveStart').textContent = versioned ? 'Jetzt mit Versionen sichern' : syncing ? 'Jetzt synchronisieren' : 'Nach Drive kopieren';
    const busy = ['running','queued','cancelling'].includes(job.status);
    $('#driveStart').disabled = busy || pendingAction || !job.settings?.sources.length; $('#driveCancel').hidden = !busy; $('#driveCancel').disabled = job.status === 'cancelling';
    const connectionFailed = job.connection?.ok === false && Date.parse(job.connection.checkedAt) > (Date.parse(job.lastSuccess) || 0);
    const configured = Boolean(job.settings?.sources.length), status = !configured ? 'Keine Quellen' : connectionFailed && !busy ? 'Zugang prüfen' : job.status === 'idle' ? job.connection?.ok ? 'Bereit' : 'Ungeprüft' : labels[job.status] || job.status;
    const badge = $('#overviewDriveStatus'); badge.textContent = status; badge.className = 'badge ' + (['failed','interrupted'].includes(job.status) || connectionFailed && !busy ? 'bad' : busy ? 'busy' : job.connection?.ok || job.status === 'success' ? 'ok' : '');
    $('#dashboardDriveStatus').textContent=badge.textContent;$('#dashboardDriveStatus').className=badge.className;
    $('#dashboardDriveSummary').textContent=job.settings?.sources.length?`${job.settings.sources.length} Quellen · ${modeLabel}`:'Keine Quellen ausgewählt';
    $('#driveOverview').classList.toggle('is-configured', configured);
    const selected = (job.sources || []).map(source => source.name).join(', ');
    $('#overviewDriveSummary').textContent = configured ? `${job.settings.remote}:${job.settings.folder} · ${selected}` : 'Quellen und Google-Zugang unter Backup-Ziele einrichten.';
    $('#overviewDriveSummary').title = $('#overviewDriveSummary').textContent;
    $('#overviewDrivePlan').textContent = configured ? `${modeLabel} · ${scheduleText(job.settings.schedule)}${job.nextAt ? ' · Nächster Termin: ' + date(job.nextAt) : ''} · ${job.timezone} · ${job.lastSuccess ? 'Letzter Erfolg: ' + date(job.lastSuccess) : 'Noch kein erfolgreicher Lauf'}` : 'Normale Dateikopie · Zeitplan unabhängig von PBS';
    $('#overviewDriveStart').disabled = !configured || busy || pendingAction; $('#overviewDriveStart').hidden = busy || !configured;
    $('#overviewDriveCancel').hidden = !busy; $('#overviewDriveCancel').disabled = job.status === 'cancelling' || pendingAction;
    $('#overviewDriveProgress').hidden = !busy && !['failed','interrupted'].includes(job.status);
    $('#overviewDriveProgress').textContent = job.message || '';
    const progress = job.progress, total = progress?.totalBytes, bytes = progress?.bytes;
    $('#driveProgress').hidden = !progress;
    if (progress) {
      const mb = value => ((value || 0) / 1024 ** 2).toLocaleString('de-DE', { maximumFractionDigits: 1 });
      $('#driveProgressText').textContent = `${mb(bytes)} / ${mb(total)} MiB · ${mb(progress.speed)} MiB/s${Number.isFinite(progress.eta) ? ' · ca. ' + Math.ceil(progress.eta / 60) + ' min verbleibend' : ''}`;
      const meter = $('#driveMeter'); if (total > 0) { meter.value = Math.min(job.status === 'success' ? 100 : 99, bytes / total * 100); $('#drivePercent').textContent = Math.floor(meter.value) + ' %'; } else { meter.removeAttribute('value'); $('#drivePercent').textContent = 'Dateien werden ermittelt …'; }
    }
    if (busy && progress) $('#overviewDriveProgress').textContent = `${job.message || ''} · ${total > 0 ? Math.floor(Math.min(job.status === 'success' ? 100 : 99, bytes / total * 100)) + ' % · ' : ''}${$('#driveProgressText').textContent} (aktuelle Quelle)`;
  }
  async function load() {
    if (loading) return; loading = true;
    try {
      const data = await api('/api/gdrive'); render(data.job);
      $('#driveTimezone').textContent = 'Zeitzone: ' + data.timezone + ' · Startfenster und Pause gelten auch hier; das eigene Google-Drive-Upload-Limit steht unter Einstellungen.';
      if (!dirty) {
        form.elements.transferMode.value = data.config.mode || 'copy'; form.elements.syncConfirmed.checked = Boolean(data.config.syncConfirmed);
        form.elements.remote.value = data.config.remote; form.elements.folder.value = data.config.folder;
        const schedule = data.config.schedule;
        form.elements.mode.value = schedule.monthDay !== undefined ? 'monthly' : schedule.days.length === 7 ? 'daily' : schedule.days.length ? 'weekly' : 'manual';
        form.elements.time.value = schedule.time || '03:00'; form.elements.month.value = schedule.monthDay || 'last';
        for (const input of form.querySelectorAll('[name="driveDay"]')) input.checked = schedule.days.includes(Number(input.value));
        $('#driveSources').replaceChildren(...data.sources.map(source => { const label = element('label', source.name, 'checkbox-label'), input = element('input'); input.type = 'checkbox'; input.name = 'source'; input.value = source.id; input.checked = data.config.sources.includes(source.id); label.prepend(input); return label; }));
        modeChanged(); initialized = true;
      }
    } catch (error) { $('#driveResult').textContent = error.message; } finally { loading = false; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const mode = form.elements.mode.value;
    const schedule = mode === 'manual' ? '' : { days: mode === 'daily' ? [1,2,3,4,5,6,7] : mode === 'weekly' ? [...form.querySelectorAll('[name="driveDay"]:checked')].map(input => Number(input.value)) : [], time: form.elements.time.value, ...(mode === 'monthly' ? { monthDay: form.elements.month.value === 'last' ? 'last' : Number(form.elements.month.value) } : {}) };
    if (mode === 'weekly' && !schedule.days.length) { $('#driveResult').textContent = 'Mindestens einen Wochentag auswählen.'; return; }
    if (form.elements.transferMode.value === 'sync' && !form.elements.syncConfirmed.checked) { $('#driveResult').textContent='Bitte das Entfernen zusätzlicher Dateien im Google-Ziel bestätigen.'; return; }
    try { await api('/api/gdrive', { mode: form.elements.transferMode.value, syncConfirmed: form.elements.syncConfirmed.checked, remote: form.elements.remote.value, folder: form.elements.folder.value, sources: [...form.querySelectorAll('[name="source"]:checked')].map(input => input.value), schedule }); dirty = false; $('#driveResult').textContent = 'Google-Drive-Einstellungen gespeichert.'; await load(); } catch (error) { $('#driveResult').textContent = error.message; }
  });
  async function perform(action, button, overview = false) {
    const resultField = $(overview ? '#overviewDriveResult' : '#driveResult');
    resultField.hidden = false;
    if (dirty && action !== 'cancel') { resultField.textContent = 'Änderungen zuerst unter Backup-Ziele speichern.'; return; }
    if (pendingAction) return;
    pendingAction = true; button.disabled = true;
    try {
      resultField.textContent = action === 'check' ? 'Google-Drive-Verbindung wird geprüft …' : '';
      const result = await api('/api/gdrive/' + action, {});
      if (action === 'start') resultField.textContent = 'Drive-Kopie angefordert. Den aktuellen Status siehst du direkt am Ziel.';
      if (action === 'cancel') resultField.textContent = 'Abbruch angefordert. Der Status zeigt, wann der Auftrag beendet ist.';
      if (action === 'check') resultField.textContent = result.ok ? 'Google Drive erreichbar (Lesetest). Schreibzugriff wird beim Kopieren geprüft.' : result.message;
      await load();
    } catch (error) { resultField.textContent = error.message; }
    finally { if (overview && !resultField.textContent) resultField.hidden = true; pendingAction = false; button.disabled = false; render(currentJob); }
  }
  for (const action of ['check','start','cancel']) $('#drive' + action[0].toUpperCase() + action.slice(1)).addEventListener('click', event => void perform(action, event.currentTarget));
  $('#overviewDriveStart').addEventListener('click', event => void perform('start', event.currentTarget, true));
  $('#overviewDriveCancel').addEventListener('click', event => void perform('cancel', event.currentTarget, true));
  function afterNavigation(hash, action) {
    if (location.hash === hash) action();
    else window.addEventListener('hashchange', () => requestAnimationFrame(action), { once:true });
  }
  for (const link of document.querySelectorAll('[data-open-drive-guide]')) link.addEventListener('click', () => afterNavigation('#guide', () => { $('#driveSetupGuide').open = true; $('#driveSetupGuide').scrollIntoView({block:'start'}); }));
  for (const link of document.querySelectorAll('[data-open-drive-settings]')) link.addEventListener('click', () => afterNavigation('#targets', () => { $('#driveSettings').open = true; $('#drivePanel').scrollIntoView({block:'start'}); void load(); }));
  for (const button of document.querySelectorAll('[data-drive-copy]')) button.addEventListener('click', async () => { try { const text = document.getElementById(button.dataset.driveCopy).textContent; if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const input = element('textarea'); input.value = text; document.body.append(input); input.select(); const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('clipboard'); } button.textContent = 'Kopiert'; } catch { notice('Befehl markieren und kopieren. Die Zwischenablage benötigt HTTPS.', true); } });
  $('#driveDisable').addEventListener('click', async event => {
    const button=event.currentTarget;button.disabled=true;
    try { const settings=currentJob?.settings; if(!settings)throw new Error('Einstellungen zuerst laden.');await api('/api/gdrive',{...settings,sources:[],schedule:''});dirty=false;await load();$('#driveResult').textContent='Drive-Kopien deaktiviert. Dateien in Google Drive und die Rclone-Anmeldung bleiben erhalten.'; }
    catch(error){$('#driveResult').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#configureDrive').addEventListener('click', () => { $('#addTargetMenu').open=false; $('#driveSettings').open = true; $('#drivePanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); void load(); });
  $('#driveSettings').addEventListener('toggle', () => { if ($('#driveSettings').open) void load(); });
  window.addEventListener('hashchange', () => { if (location.hash === '#targets') void load(); });
  function renderActivity(container, job) {
    container.replaceChildren();container.classList.add('progress-line');
    const progress=job.progress, total=progress?.totalBytes, bytes=progress?.bytes;
    const measuring=job.status!=='queued' && Number.isFinite(total) && total>0 && Number.isFinite(bytes);
    const meter=element('progress');meter.max=100;meter.setAttribute('aria-label','Google-Drive-Fortschritt der aktuellen Quelle');
    if(measuring)meter.value=Math.floor(Math.min(99,Math.max(0,bytes/total*100)));
    if(job.status!=='queued')container.append(meter);
    const text=element('span', job.status==='queued' ? 'Google Drive wartet · '+(job.message||'Startbedingungen werden geprüft.') : measuring ? $('#overviewDriveProgress').textContent+(bytes>=total?' · Datenmenge übertragen, Abschluss läuft …':'') : 'Google Drive · '+(job.message||'Warte auf Fortschrittsdaten …'));
    text.id='progressEstimate';text.title='Google-Drive-Messwerte für die aktuelle Quelle. Der Auftrag ist erst nach erfolgreichem Prozessende abgeschlossen; Rclone kann die Gesamtmenge während des Laufs ändern.';container.append(text);
  }
  return { renderActivity, update(job) { render(job); if (!initialized && location.hash === '#targets') void load(); }, load };
}
