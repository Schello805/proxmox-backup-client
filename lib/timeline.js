'use strict';
const { scheduleKey, occurrence, matchesDay } = require('./planning');
const { targetConfig } = require('./targets');
const addDay = (day, delta) => new Date(Date.parse(day + 'T12:00:00Z') + delta * 86400000).toISOString().slice(0, 10);
function dayStart(day, timezone) {
  for (let hour = 0; hour < 24; hour++) { const value = occurrence(day, `${String(hour).padStart(2, '0')}:00`, timezone); if (value !== null) return value; }
  return null;
}
function lastDuration(source, config, state) {
  const target = targetConfig(config, source.target);
  const records = [...(state.history?.[source.id] || [])];
  const job = state.jobs?.[source.id];
  if (job?.status === 'success' && job.endedAt) records.push(job);
  const latest = records.filter(record => record.status === 'success' && record.path === source.path && record.repository === target.repository && (record.namespace || '') === (target.namespace || '') && Number.isFinite(Date.parse(record.endedAt)))
    .map(record => ({ ...record, seconds: Number.isFinite(record.durationSeconds) ? record.durationSeconds : (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000 }))
    .filter(record => Number.isFinite(record.seconds) && record.seconds >= 0)
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))[0];
  return latest ? { seconds: latest.seconds, endedAt: latest.endedAt } : null;
}
function createTimeline(config, state, now = new Date()) {
  const today = scheduleKey(now, config.timezone).day;
  const days = Array.from({ length: 8 }, (_, index) => { const day = addDay(today, index); return { day, start: dayStart(day, config.timezone) }; });
  const start = days[0].start, end = days[7].start;
  const rows = config.sources.map(source => {
    const schedule = config.schedules[source.id], duration = lastDuration(source, config, state), events = [];
    // Include runs starting before the visible week when their recorded duration reaches into it.
    const carryDays = duration ? Math.min(31, Math.ceil(duration.seconds / 86400) + 1) : 0;
    for (let delta = -carryDays; delta < 7; delta++) {
      const day = addDay(today, delta);
      if (!matchesDay(schedule, day)) continue;
      const timestamp = occurrence(day, schedule.time, config.timezone); if (timestamp === null) continue;
      const stop = duration ? timestamp + duration.seconds * 1000 : null;
      if (timestamp >= end || (timestamp < start && (stop === null || stop <= start))) continue;
      events.push({ start: timestamp, end: stop, past: timestamp < now.getTime(), overlap: false });
    }
    return { id: source.id, name: source.name, target: source.target || 'primary', repository: targetConfig(config, source.target).repository, manual: !schedule.days.length && schedule.monthDay === undefined, duration, events };
  });
  const measured = rows.flatMap(row => row.events.filter(event => event.end > event.start).map(event => ({ id: row.id, event }))).sort((a, b) => a.event.start - b.event.start);
  for (let index = 0; index < measured.length; index++) for (let other = index + 1; other < measured.length && measured[other].event.start < measured[index].event.end; other++) {
    measured[index].event.overlap = measured[other].event.overlap = true;
  }
  return { timezone: config.timezone, now: now.getTime(), start, end, days: days.slice(0, 7).map((day, index) => ({ ...day, end: days[index + 1].start })), rows };
}
module.exports = { createTimeline, lastDuration };
