'use strict';
const { readJSON } = require('./storage');
const { targetConfig, targetsFor } = require('./targets');
function parseCapacity(value) {
  if (!value || Array.isArray(value) || !['total','used','avail'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) || value.total <= 0 || value.used > value.total || value.avail > value.total) throw new Error('Ungültiger Speicherstand.');
  return { total: value.total, used: value.used, available: value.avail, usedPercent: Math.round(value.used / value.total * 1000) / 10 };
}
function createCapacity({ getConfig, environment, run, save, cacheFile, now = () => Date.now() }) {
  const caches = {}, pending = new Map();
  for (const target of [...new Set(['primary','secondary',...targetsFor(getConfig()).map(item=>item.id)])]) { try { caches[target] = readJSON(cacheFile + '.' + target, {}); } catch { caches[target] = {}; } }
  function keyFor(target) { const config=targetConfig(getConfig(),target); return config.repository; }
  function current(target) { const key=keyFor(target), data=caches[target]?.key===key?caches[target]:{}; return { ...data, stale: Boolean(data.checkedAt && now()-Date.parse(data.checkedAt)>20*60000), warning: Boolean(data.total && data.usedPercent>=getConfig().capacityWarnPercent) }; }
  async function refresh(target) {
    const key=keyFor(target); if (!key || !targetConfig(getConfig(),target).password) return { error:'PBS-Zugang fehlt.', warning:false };
    if(pending.has(target)) return pending.get(target);
    const request=(async()=>{
      try { const {stdout}=await run('proxmox-backup-client',['status','--output-format','json'],{env:environment(target),timeout:15000,maxBuffer:65536}); caches[target]={key,...parseCapacity(JSON.parse(stdout)),checkedAt:new Date(now()).toISOString(),error:''}; }
      catch { caches[target]={...current(target),key,error:'Speicherstand nicht abrufbar. PBS-Rechte, Client-Version und Verbindung prüfen.',attemptedAt:new Date(now()).toISOString()}; }
      save(cacheFile+'.'+target,caches[target]); return current(target);
    })().finally(()=>pending.delete(target));pending.set(target,request);return request;
  }
  return { current, refresh, all:()=>Object.fromEntries(targetsFor(getConfig()).map(target=>[target.id,current(target.id)])), get busy(){return pending.size>0;}, due:target=>!current(target).attemptedAt&&!current(target).checkedAt || now()-Date.parse(current(target).attemptedAt||current(target).checkedAt)>15*60000 };
}
module.exports={parseCapacity,createCapacity};
