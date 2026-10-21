export function installDrive({ api, element, notice }) {
  const $ = selector => document.querySelector(selector), form = $('#driveForm');
  let initialized = false, dirty = false, loading = false;
  const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  for (let day = 1; day <= 31; day++) $('#driveMonth').append(new Option(String(day), String(day)));
  $('#driveMonth').append(new Option('Letzter Tag', 'last'));
  for (let day = 1; day <= 7; day++) { const label = element('label', dayNames[day - 1]); const input = element('input'); input.type = 'checkbox'; input.value = day; input.name = 'driveDay'; label.prepend(input); $('#driveDays').append(label); }
  function modeChanged() { $('#driveDays').hidden = form.elements.mode.value !== 'weekly'; $('#driveMonthLabel').hidden = form.elements.mode.value !== 'monthly'; form.elements.time.disabled = form.elements.mode.value === 'manual'; }
  form.addEventListener('input', () => dirty = true); form.addEventListener('change', () => { dirty = true; modeChanged(); });
  function render(job) {
    if (!job) return;
    const labels = { idle: 'Noch keine Kopie', queued: 'Wartet', running: 'Läuft', cancelling: 'Abbruch läuft', cancelled: 'Abgebrochen', failed: 'Fehlgeschlagen', success: 'Erfolgreich', interrupted: 'Unterbrochen' };
    $('#driveStatus').textContent = labels[job.status] || job.status;
    $('#driveMessage').textContent = job.message || 'Quellen auswählen, speichern und Verbindung prüfen.';
    $('#driveLast').textContent = job.lastSuccess ? 'Letzter Erfolg: ' + new Date(job.lastSuccess).toLocaleString('de-DE') : 'Noch kein erfolgreicher Lauf';
    const busy = ['running','queued','cancelling'].includes(job.status);
    $('#driveStart').disabled = busy; $('#driveCancel').hidden = !busy; $('#driveCancel').disabled = job.status === 'cancelling';
    const progress = job.progress, total = progress?.totalBytes, bytes = progress?.bytes;
    $('#driveProgress').hidden = !progress;
    if (progress) {
      const mb = value => ((value || 0) / 1024 ** 2).toLocaleString('de-DE', { maximumFractionDigits: 1 });
      $('#driveProgressText').textContent = `${mb(bytes)} / ${mb(total)} MiB · ${mb(progress.speed)} MiB/s${Number.isFinite(progress.eta) ? ' · ca. ' + Math.ceil(progress.eta / 60) + ' min verbleibend' : ''}`;
      const meter = $('#driveMeter'); if (total > 0) { meter.value = Math.min(100, bytes / total * 100); $('#drivePercent').textContent = Math.floor(meter.value) + ' %'; } else { meter.removeAttribute('value'); $('#drivePercent').textContent = 'Dateien werden ermittelt …'; }
    }
    $('#driveHistory').replaceChildren(...(job.history || []).map(run => element('li', `${new Date(run.endedAt).toLocaleString('de-DE')} · ${labels[run.status] || run.status} · ${(run.results || []).length} Quellen kopiert${run.message ? ' · ' + run.message : ''}`)));
  }
  async function load() {
    if (loading) return; loading = true;
    try {
      const data = await api('/api/gdrive'); render(data.job);
      $('#driveTimezone').textContent = 'Zeitzone: ' + data.timezone + ' · Startfenster, Pause und Upload-Limit aus den Einstellungen gelten auch hier.';
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
  for (const action of ['check','start','cancel']) $('#drive' + action[0].toUpperCase() + action.slice(1)).addEventListener('click', async event => {
    if (dirty && action !== 'cancel') { $('#driveResult').textContent = 'Änderungen zuerst speichern.'; return; }
    const button = event.currentTarget; button.disabled = true;
    try { $('#driveResult').textContent = action === 'check' ? 'Google-Drive-Verbindung wird geprüft …' : ''; const result = await api('/api/gdrive/' + action, {}); if (action === 'check') $('#driveResult').textContent = result.ok ? 'Google Drive erreichbar (Lesetest). Schreibzugriff wird beim Kopieren geprüft.' : result.message; await load(); } catch (error) { $('#driveResult').textContent = error.message; } finally { button.disabled = false; }
  });
  for (const button of document.querySelectorAll('[data-drive-copy]')) button.addEventListener('click', async () => { try { const text = document.getElementById(button.dataset.driveCopy).textContent; if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const input = element('textarea'); input.value = text; document.body.append(input); input.select(); const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('clipboard'); } button.textContent = 'Kopiert'; } catch { notice('Befehl markieren und kopieren. Die Zwischenablage benötigt HTTPS.', true); } });
  $('#configureDrive').addEventListener('click', () => { $('#drivePanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); void load(); });
  window.addEventListener('hashchange', () => { if (location.hash === '#targets') void load(); });
  return { update(job) { render(job); if (!initialized && location.hash === '#targets') void load(); }, load };
}
