'use strict';
function normalizeSchedule(value) {
  // Version 1: eine Uhrzeit bedeutete täglich; leere Zeichenfolge war deaktiviert.
  if (typeof value === 'string') value = { days: value ? [1, 2, 3, 4, 5, 6, 7] : [], time: value };
  if (!value || typeof value !== 'object' || !Array.isArray(value.days) || typeof value.time !== 'string') throw new Error('Ungültiger Wochenplan.');
  if (value.days.length > 7 || value.days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(value.days).size !== value.days.length) throw new Error('Ungültige Wochentage.');
  if (value.days.length ? !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) : value.time !== '') throw new Error('Bitte eine gültige Uhrzeit für den Wochenplan wählen.');
  return { days: [...value.days].sort((a, b) => a - b), time: value.time };
}
const formatters = new Map();
function scheduleKey(date = new Date(), timezone = 'Europe/Berlin') {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const parts = formatters.get(timezone).format(date);
  const day = parts.slice(0, 10);
  return { day, time: parts.slice(11, 16), weekday: new Date(day + 'T12:00:00Z').getUTCDay() || 7 };
}
function scheduleDue(schedule, now, lastDay) {
  return schedule.days.includes(now.weekday) && schedule.time === now.time && lastDay !== now.day;
}


// Lokale Uhrzeiten werden gegen mögliche UTC-Offsets geprüft: übersprungene
// DST-Uhrzeiten haben keinen Termin; doppelte Stunden erhalten nur den ersten.
const occurrenceCache = new Map();
function occurrence(day, time, timezone) {
  const key = `${timezone}/${day}/${time}`;
  if (occurrenceCache.has(key)) return occurrenceCache.get(key);
  const naive = Date.parse(`${day}T${time}:00Z`), offsets = new Set(), matches = [];
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = naive + hours * 3600000, local = scheduleKey(new Date(probe), timezone);
    offsets.add(Date.parse(`${local.day}T${local.time}:00Z`) - probe);
  }
  for (const offset of offsets) {
    const utc = naive - offset, local = scheduleKey(new Date(utc), timezone);
    if (local.day === day && local.time === time) matches.push(utc);
  }
  const result = matches.length ? Math.min(...matches) : null;
  if (occurrenceCache.size > 512) occurrenceCache.clear(); occurrenceCache.set(key, result);
  return result;
}
function scheduleWindow(schedule, timezone, now = new Date(), lastDay) {
  if (!schedule.days.length) return { nextAt: null, lastDueAt: null };
  const today = scheduleKey(now, timezone).day, current = now.getTime();
  let nextAt = null, lastDueAt = null;
  for (let delta = -15; delta <= 15; delta++) {
    const day = new Date(Date.parse(today + 'T12:00:00Z') + delta * 86400000).toISOString().slice(0,10);
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay() || 7;
    if (!schedule.days.includes(weekday)) continue;
    const timestamp = occurrence(day, schedule.time, timezone); if (timestamp === null) continue;
    if (timestamp <= current) lastDueAt = timestamp;
    if (timestamp > current && day !== lastDay && nextAt === null) nextAt = timestamp;
  }
  return { nextAt: nextAt === null ? null : new Date(nextAt).toISOString(), lastDueAt: lastDueAt === null ? null : new Date(lastDueAt).toISOString() };
}
function healthFor(schedule, timezone, now, watchSince, job = {}, staleAfterDays = 14, lastDay) {
  const window = scheduleWindow(schedule, timezone, now, lastDay), current = now.getTime();
  const due = window.lastDueAt && Date.parse(window.lastDueAt), success = Date.parse(job.lastSuccess || '') || 0;
  const busy = ['running','queued','cancelling'].includes(job.status);
  const missed = Boolean(due && due >= Date.parse(watchSince) && current >= due + 10 * 60000 && success < due && !busy);
  const stale = Boolean(success && current - success > staleAfterDays * 86400000 && !busy);
  return { ...window, missed, stale, message: missed ? 'Geplanter Lauf ohne Erfolg (mehr als 10 Minuten überfällig).' : stale ? `Letzter Erfolg älter als ${staleAfterDays} Tage.` : '' };
}

module.exports = { normalizeSchedule, scheduleKey, scheduleDue, occurrence, scheduleWindow, healthFor };
