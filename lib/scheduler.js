'use strict';
const { healthFor, scheduleKey, scheduleDue, occurrence } = require('./planning');
function createScheduler({ getConfig, state, persist, backups, log, notify, isMaintenance = () => false, clock = () => new Date() }) {
  let stopping = false, timer;
  function health(id, now = new Date()) { const config=getConfig(),result=healthFor(config.schedules[id],config.timezone,now,state.watchSince[id],state.jobs[id],config.staleAfterDays,state.triggered[id]);return config.sources.find(item=>item.id===id)?.selection?.length===0?{...result,missed:false,stale:false,message:''}:result; }
  function tick() {
    if (stopping || isMaintenance()) return; backups.tick?.(); const config = getConfig();
    const date = clock(), now = scheduleKey(date, config.timezone);
    for (const source of config.sources.filter(item=>!item.partitioned)) {
      const id = source.id;
      if (scheduleDue(config.schedules[id], now, state.triggered[id]) && occurrence(now.day, now.time, config.timezone) === Math.floor(date.getTime() / 60000) * 60000) {
        state.triggered[id] = now.day; persist();
        try { backups.enqueue(id, 'schedule'); } catch (e) { log(id, `\n${date.toISOString()} · Zeitplan übersprungen: ${e.message}\n`); }
      }
      const status = health(id, date);
      if (status.missed) notify(`missed/${id}/${status.lastDueAt}`, `${source.name}: Geplanter Backup-Termin ohne Erfolg. Bitte Backup Control prüfen.`);
      if (status.stale) notify(`stale/${id}/${state.jobs[id].lastSuccess}`, `${source.name}: Letzter Backup-Erfolg liegt mehr als ${config.staleAfterDays} Tage zurück.`);
    }
  }
  return { health, tick, start() { timer ||= setInterval(tick, 10000); }, stop() { stopping = true; clearInterval(timer); } };

}
module.exports = { createScheduler };
