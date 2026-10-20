export function installTimeline({ element, openSource }) {
  const root = document.querySelector('#backupTimeline'), select = document.querySelector('#timelineRange');
  let data = null, signature = '';
  function duration(seconds) { const rounded = Math.round(seconds); return rounded < 60 ? `${rounded} s` : rounded < 3600 ? `${Math.floor(rounded / 60)} min ${rounded % 60 ? rounded % 60 + ' s' : ''}`.trim() : `${Math.floor(rounded / 3600)} h ${Math.floor(rounded % 3600 / 60)} min`; }
  function paint() {
    if (!data) return;
    const selected = data.days.find(day => day.day === select.value), start = selected?.start ?? data.start, end = selected?.end ?? data.end, span = end - start;
    const format = timestamp => new Intl.DateTimeFormat('de-DE', { timeZone: data.timezone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
    root.replaceChildren(); const chart = element('div', undefined, 'gantt-chart'), header = element('div', undefined, 'gantt-line gantt-header'), source = element('div', 'Quelle · letzte Dauer', 'gantt-source'), axis = element('div', undefined, 'gantt-track');
    const ticks = selected ? Array.from({ length: Math.ceil(span / 3600000) }, (_, index) => { const timestamp = start + index * 3600000; return { start: timestamp, end: Math.min(timestamp + 3600000, end), label: new Intl.DateTimeFormat('de-DE', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)) }; }) : data.days.map(day => ({ ...day, label: new Intl.DateTimeFormat('de-DE', { timeZone: data.timezone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(day.start)) }));
    for (const tick of ticks) { const label = element('span', tick.label, 'gantt-tick'); label.style.left = `${(tick.start - start) / span * 100}%`; label.style.width = `${(tick.end - tick.start) / span * 100}%`; axis.append(label); }
    header.append(source, axis); chart.append(header);
    let count = 0, overlaps = false;
    for (const row of data.rows) {
      const line = element('div', undefined, 'gantt-line'); line.dataset.timelineSource = row.id;
      const info = element('div', undefined, 'gantt-source'), button = element('button', row.name, 'source-link'); button.type = 'button'; button.setAttribute('aria-label', `Zeitplan ${row.name} im Detail öffnen`); button.addEventListener('click', () => openSource(row.id));
      const subtitle = row.duration ? `Zuletzt: ${duration(row.duration.seconds)}` : 'Noch keine gemessene Dauer';
      const note = element('small', subtitle); note.title = row.duration ? `Letzter erfolgreicher Lauf: ${format(Date.parse(row.duration.endedAt))} · ${row.repository}` : 'Ein erfolgreicher App-Lauf mit diesem Pfad und Backup-Ziel liefert die Balkenlänge.';
      info.append(button, note); const track = element('div', undefined, 'gantt-track');
      for (const tick of ticks) { const grid = element('span', undefined, 'gantt-grid'); grid.style.left = `${(tick.start - start) / span * 100}%`; track.append(grid); }
      const events = row.events.filter(event => event.start < end && (event.end === null || event.end === event.start ? event.start >= start : event.end > start));
      for (const event of events) {
        const unknown = event.end === null, point = unknown || event.end === event.start;
        const bar = element('button', undefined, `gantt-bar${point ? ' point' : ''}${unknown ? ' unknown' : ''}${event.past ? ' past' : ''}${event.overlap ? ' overlap' : ''}`); bar.type = 'button';
        const description = `${row.name} · ${format(event.start)} · ${unknown ? 'Dauer noch unbekannt' : 'Dauer zuletzt: ' + duration(row.duration.seconds) + ' · rechnerisches Ende: ' + format(event.end)}${event.overlap ? ' · mögliche Warteschlange' : ''}`;
        bar.title = description; bar.setAttribute('aria-label', description); bar.style.left = `${Math.max(0, (event.start - start) / span * 100)}%`; if (!point) bar.style.width = `${(Math.min(end, event.end) - Math.max(start, event.start)) / span * 100}%`;
        bar.addEventListener('click', () => openSource(row.id)); track.append(bar); count++; overlaps ||= event.overlap;
      }
      if (!events.length) track.append(element('span', row.manual ? 'Nur manuell' : 'Kein Termin in diesem Zeitraum', 'gantt-empty'));
      if (data.now >= start && data.now < end) { const now = element('span', undefined, 'gantt-now'); now.style.left = `${(data.now - start) / span * 100}%`; now.title = 'Jetzt'; track.append(now); }
      line.append(info, track); chart.append(line);
    }
    root.append(chart);
    document.querySelector('#timelineSummary').textContent = `${data.timezone} · ${count} dargestellte Termine${overlaps ? ' · Überschneidungen: Aufträge warten gegebenenfalls aufeinander.' : ''}`;
  }
  select.addEventListener('change', paint);
  return { update(next) { data = next; if (!data) return; const nextSignature = data.days.map(day => day.day).join(); if (signature !== nextSignature) { const selected = select.value; signature = nextSignature; const all = element('option', 'Nächste 7 Tage'); all.value = 'week'; select.replaceChildren(all, ...data.days.map(day => { const option = element('option', new Intl.DateTimeFormat('de-DE', { timeZone: data.timezone, weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(day.start))); option.value = day.day; return option; })); select.value = [...select.options].some(option => option.value === selected) ? selected : 'week'; } paint(); } };
}
