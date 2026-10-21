export function installDrive({ api, element, notice, scheduleText, date }) {
  const $ = selector => document.querySelector(selector), form = $('#driveForm');
  let initialized = false, dirty = false, loading = false, currentJob = null, pendingAction = false;
  const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  for (let day = 1; day <= 31; day++) $('#driveMonth').append(new Option(String(day), String(day)));
  $('#driveMonth').append(new Option('Letzter Tag', 'last'));
  for (let day = 1; day <= 7; day++) { const label = element('label', dayNames[day - 1]); const input = element('input'); input.type = 'checkbox'; input.value = day; input.name = 'driveDay'; label.prepend(input); $('#driveDays').append(label); }
  function modeChanged() { $('#driveDays').hidden = form.elements.mode.value !== 'weekly'; $('#driveMonthLabel').hidden = form.elements.mode.value !== 'monthly'; form.elements.time.disabled = form.elements.mode.value === 'manual'; }
  form.addEventListener('input', () => dirty = true); form.addEventListener('change', () => { dirty = true; modeChanged(); });
  function render(job) {
    if (!job) return;
    currentJob = job;
    const labels = { idle: 'Noch keine Kopie', queued: 'Wartet', running: 'Läuft', cancelling: 'Abbruch läuft', cancelled: 'Abgebrochen', failed: 'Fehlgeschlagen', success: 'Erfolgreich', interrupted: 'Unterbrochen' };
    $('#driveStatus').textContent = labels[job.status] || job.status;
    $('#driveMessage').textContent = job.message || 'Quellen auswählen, speichern und Verbindung prüfen.';
    $('#driveLast').textContent = job.lastSuccess ? 'Letzter Erfolg: ' + date(job.lastSuccess) : 'Noch kein erfolgreicher Lauf';
    const busy = ['running','queued','cancelling'].includes(job.status);
    $('#driveStart').disabled = busy || pendingAction || !job.settings?.sources.length; $('#driveCancel').hidden = !busy; $('#driveCancel').disabled = job.status === 'cancelling';
    const connectionFailed = job.connection?.ok === false && Date.parse(job.connection.checkedAt) > (Date.parse(job.lastSuccess) || 0);
    const configured = Boolean(job.settings?.sources.length), status = !configured ? 'Keine Quellen' : connectionFailed && !busy ? 'Zugang prüfen' : job.status === 'idle' ? job.connection?.ok ? 'Bereit' : 'Ungeprüft' : labels[job.status] || job.status;
    const badge = $('#overviewDriveStatus'); badge.textContent = status; badge.className = 'badge ' + (['failed','interrupted'].includes(job.status) || connectionFailed && !busy ? 'bad' : busy ? 'busy' : job.connection?.ok || job.status === 'success' ? 'ok' : '');
    $('#driveOverview').classList.toggle('is-configured', configured);
    const selected = (job.sources || []).map(source => source.name).join(', ');
    $('#overviewDriveSummary').textContent = configured ? `${job.settings.remote}:${job.settings.folder} · ${selected}` : 'Quellen und Google-Zugang unter Backup-Ziele einrichten.';
    $('#overviewDriveSummary').title = $('#overviewDriveSummary').textContent;
    $('#overviewDrivePlan').textContent = configured ? `${scheduleText(job.settings.schedule)}${job.nextAt ? ' · Nächster Termin: ' + date(job.nextAt) : ''} · ${job.timezone} · ${job.lastSuccess ? 'Letzter Erfolg: ' + date(job.lastSuccess) : 'Noch kein erfolgreicher Lauf'}` : 'Normale Dateikopie · Zeitplan unabhängig von PBS';
    $('#overviewDriveStart').disabled = !configured || busy || pendingAction; $('#overviewDriveStart').hidden = busy || !configured;
    $('#overviewDriveCancel').hidden = !busy; $('#overviewDriveCancel').disabled = job.status === 'cancelling' || pendingAction;
    $('#overviewDriveProgress').hidden = !busy && !['failed','interrupted'].includes(job.status);
    $('#overviewDriveProgress').textContent = job.message || '';
    const progress = job.progress, total = progress?.totalBytes, bytes = progress?.bytes;
    $('#driveProgress').hidden = !progress;
    if (progress) {
      const mb = value => ((value || 0) / 1024 ** 2).toLocaleString('de-DE', { maximumFractionDigits: 1 });
      $('#driveProgressText').textContent = `${mb(bytes)} / ${mb(total)} MiB · ${mb(progress.speed)} MiB/s${Number.isFinite(progress.eta) ? ' · ca. ' + Math.ceil(progress.eta / 60) + ' min verbleibend' : ''}`;
      const meter = $('#driveMeter'); if (total > 0) { meter.value = Math.min(100, bytes / total * 100); $('#drivePercent').textContent = Math.floor(meter.value) + ' %'; } else { meter.removeAttribute('value'); $('#drivePercent').textContent = 'Dateien werden ermittelt …'; }
    }
    if (busy && progress) $('#overviewDriveProgress').textContent = `${job.message || ''} · ${total > 0 ? Math.floor(Math.min(100, bytes / total * 100)) + ' % · ' : ''}${$('#driveProgressText').textContent} (aktuelle Quelle)`;
    $('#driveHistory').replaceChildren(...(job.history || []).map(run => element('li', `${date(run.endedAt)} · ${labels[run.status] || run.status} · ${(run.results || []).length} Quellen kopiert${run.message ? ' · ' + run.message : ''}`)));
  }
  async function load() {
    if (loading) return; loading = true;
    try {
      const data = await api('/api/gdrive'); render(data.job);
      $('#driveTimezone').textContent = 'Zeitzone: ' + data.timezone + ' · Startfenster und Pause gelten auch hier; das eigene Google-Drive-Upload-Limit steht unter Einstellungen.';
      if (!dirty) {
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
    try { await api('/api/gdrive', { remote: form.elements.remote.value, folder: form.elements.folder.value, sources: [...form.querySelectorAll('[name="source"]:checked')].map(input => input.value), schedule }); dirty = false; $('#driveResult').textContent = 'Google-Drive-Einstellungen gespeichert.'; await load(); } catch (error) { $('#driveResult').textContent = error.message; }
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
  $('#configureDrive').addEventListener('click', () => { $('#addTargetMenu').open=false; $('#driveSettings').open = true; $('#drivePanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); void load(); });
  $('#driveSettings').addEventListener('toggle', () => { if ($('#driveSettings').open) void load(); });
  window.addEventListener('hashchange', () => { if (location.hash === '#targets') void load(); });
  return { update(job) { render(job); if (!initialized && location.hash === '#targets') void load(); }, load };
}
