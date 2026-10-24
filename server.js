'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadConfig, loadState, saveJSON, checkRuntime, acquireLock } = require('./lib/storage');
const { createConfigService } = require('./lib/config-service');
const strategy = require('./lib/strategy');
const { createHistory } = require('./lib/history');
const { exportConfig, previewRestore, revision } = require('./lib/config-backup');
const { restoreInfo } = require('./lib/restore');
const { compareRuns } = require('./lib/run-comparison');
const { createBackups } = require('./lib/backups');
const { createScheduler } = require('./lib/scheduler');
const { createPBS } = require('./lib/pbs');
const { createAuth } = require('./lib/auth');
const { createNotifier } = require('./lib/notifier');
const { createInspector } = require('./lib/inspect');
const { createSourceSizes } = require('./lib/source-sizes');
const { createDiscovery } = require('./lib/discovery');
const { createSystem } = require('./lib/system');
const { createUpdates } = require('./lib/updates');
const { createDiagnostics } = require('./lib/diagnostics');
const { createCapacity } = require('./lib/capacity');
const { planSuggestions } = require('./lib/plan-suggestions');
const { backupSummary } = require('./lib/backup-summary');
const { createTimeline } = require('./lib/timeline');
const { healthFor } = require('./lib/planning');
const { estimateProgress } = require('./lib/progress');
const { repositoryFor, targetConfig, targetsFor } = require('./lib/targets');
const { sendNotification } = require('./notifications');
const run = promisify(execFile);
const ROOT = __dirname, DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const CONFIG = process.env.CONFIG_FILE || path.join(ROOT, 'config.json');
const HOST = process.env.HOST || '127.0.0.1', PORT = Number(process.env.PORT ?? 3000), PASS = process.env.APP_PASSWORD || '';
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const storageChecks = checkRuntime({ data: DATA, configFile: CONFIG, port: PORT });
const releaseLock = acquireLock(DATA);
process.once('exit', releaseLock);
const initial = loadConfig(CONFIG, path.join(ROOT, 'config.example.json'), PASS);
const STATE = path.join(DATA, 'state.json'), state = loadState(STATE);
const persist = () => saveJSON(STATE, state);
const STRATEGY = path.join(DATA, 'strategy.json');
let strategyDocument = fs.existsSync(STRATEGY) ? JSON.parse(fs.readFileSync(STRATEGY, 'utf8')) : strategy.empty();
const normalizedStrategy = strategy.normalize(strategyDocument).document;
strategyDocument = {...normalizedStrategy, mapping: strategyDocument.mapping || {datasets:{},targets:{}}};
for (const source of initial.sources) state.watchSince[source.id] ||= new Date().toISOString();
let backups, pbs, capacity, drive, autoPartitions;
const { createPartitions } = require('./lib/partitions');
const configs = createConfigService({ initial, state, write: value => saveJSON(CONFIG, value), persist, password: PASS, isBusy: () => backups?.busy || drive?.busy || pbs?.busy || capacity?.busy, onChange: (previous, next) => { drive?.changed(previous, next); for (const target of [...new Set([...targetsFor(previous),...targetsFor(next)].map(item=>item.id))]) if (JSON.stringify(targetConfig(previous,target)) !== JSON.stringify(targetConfig(next,target))) state.pbsCheckAfter[target] = new Date().toISOString(); if (['additionalDatastores','repository','secondaryDatastore','password','fingerprint','namespace','secondaryPBS'].some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))) pbs.invalidate(); } });
const getConfig = configs.get;
const isMaintenance = () => fs.existsSync(path.join(DATA, 'maintenance'));
const logbook = require('./lib/logbook').createLogbook({getConfig,state,data:DATA,password:PASS,getDiagnostics:()=>diagnostics.current(),getUpdates:()=>updates.current()});
const history = createHistory({ state, data: DATA, persist, getConfig, password: PASS });
const notifier = createNotifier({ getConfig, state, persist });
const inspectPath = createInspector(run);
const mountStatus = require('./lib/mount-status').createMountStatus({ inspectPath });
const discovery = createDiscovery({ getConfig });
const sourceSizes = createSourceSizes({ run, inspectPath, isBusy: () => backups?.busy || drive?.busy || isMaintenance() });
function environment(target = 'primary') {
  const env = { ...process.env }, config = targetConfig(getConfig(), target);
  for (const key of Object.keys(env)) if (key.startsWith('PBS_')) delete env[key];
  return { ...env, PBS_REPOSITORY: config.repository, PBS_PASSWORD: config.password, PBS_FINGERPRINT: config.fingerprint, PBS_NAMESPACE: config.namespace };
}
backups = createBackups({ state, data: DATA, persist, getConfig, inspectPath, prepareSource:(source,isCurrent)=>autoPartitions.prepare(source,isCurrent), checkCapacity:source=>autoPartitions.check(source), afterSuccess:source=>autoPartitions.succeeded(source), environment, log: history.log, archive: history.archive, verifySnapshot: (id, job) => pbs.verifySnapshot(id, job), notify: notifier.notify, isMaintenance, isBlocked: () => drive?.active, getSourceSize: source => sourceSizes.peek(source), onBatchComplete: batch => notifier.notify('summary/'+batch.id, backupSummary(batch), {success:true,warning:batch.results.some(result=>!['success','skipped'].includes(result.status))}) });
drive = require('./lib/gdrive').createDrive({ getConfig, state, persist, data: DATA, inspectPath, notify: notifier.notify, blocked: () => backups.busy || pbs?.busy || capacity?.busy || isMaintenance() || backups.paused });
const driveTimer = setInterval(() => drive.tick(), 10000);
const scheduler = createScheduler({ getConfig, state, persist, backups, log: history.log, notify: notifier.notify, isMaintenance });
pbs = createPBS({ getConfig, environment, run, cacheFile: path.join(DATA, 'pbs.json'), save: saveJSON });
capacity = createCapacity({getConfig,environment,run,save:saveJSON,cacheFile:path.join(DATA,'capacity.json')});
const partitions = createPartitions({getConfig,inspectPath,run,getSourceSize:source=>source.path?sourceSizes.peek(source):null,apply: input=>configs.apply(input),planAutomatic:(...args)=>autoPartitions.plan(...args),saveLedger:(id,ledger)=>{state.autoFiles[id]=ledger;persist();}});
autoPartitions=require('./lib/auto-partitions').createAutoPartitions({getConfig,list:partitions.list,capacity,updateSelections:configs.updateSelections,state,persist});
async function pollCapacity(){ if(backups.busy||drive.busy||pbs.busy||capacity.busy||isMaintenance())return; for(const target of targetsFor(getConfig())){if(backups.busy||isMaintenance())break;if(capacity.due(target.id))await capacity.refresh(target.id);} if(drive.capacityDue())await drive.refreshCapacity(); }
const capacityTimer=setInterval(()=>void pollCapacity().catch(()=>console.warn('Speicherstand konnte nicht gespeichert werden.')),60000);
void pollCapacity().catch(()=>console.warn('Speicherstand konnte nicht gespeichert werden.'));
const system = createSystem({ run, getConfig, storageChecks });
const updates = createUpdates({ run, root: ROOT });
void updates.installed();
const diagnostics = createDiagnostics({ getConfig, system, inspectPath, pbs, storageChecks: () => checkRuntime({ data: DATA, configFile: CONFIG, port: PORT }) });
const auth = createAuth({ getConfig, password: PASS, json });
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  req.setEncoding('utf8');
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('Anfrage zu groß.'); }
  return JSON.parse(text);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Fremder Ursprung.' });
      if (req.headers['x-requested-with'] !== 'qnap-dashboard') return json(res, 403, { error: 'Anfrage-Header fehlt.' });
    }
    // Nur die App-Hülle ist öffentlich. Daten und Aktionen benötigen eine Sitzung.
    const assets = { '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/workspace.css': ['workspace.css', 'text/css'], ...Object.fromEntries(['execution','strategy','source-help','partitions','logbook','dashboard','gdrive','api','views','forms','maintenance','assistant','timeline','problems','operations','controls','restore'].map(name => ['/js/' + name + '.js', ['js/' + name + '.js', 'text/javascript']])) };
    if (req.method === 'GET' && assets[url.pathname]) {
      const [file, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', file)));
    }
    if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { authenticated: auth.authorized(req), authEnabled: configs.get().authEnabled });
    if (req.method === 'POST' && url.pathname === '/api/login') return auth.login(req, res, await body(req));
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Nicht gefunden.' });
    if (!auth.authorized(req)) return json(res, 401, { error: 'Bitte anmelden.' });
    if (req.method === 'GET' && url.pathname === '/api/strategy') return json(res,200,{document:strategyDocument,revision:strategy.revision(strategyDocument),view:strategy.strategyView(strategyDocument,getConfig(),state,drive.snapshot(),new Date(),url.searchParams.get('week'))});
    if (req.method === 'POST' && url.pathname === '/api/strategy/preview') {
      const input=await body(req),preview=strategy.normalize(input.document);
      return json(res,200,{...preview,revision:strategy.revision(strategyDocument),counts:Object.fromEntries(Object.entries(preview.document.data).map(([key,rows])=>[key,rows.length]))});
    }
    if (req.method === 'POST' && ['/api/strategy/import','/api/strategy/save'].includes(url.pathname)) {
      const input=await body(req);
      if(input.revision!==strategy.revision(strategyDocument))return json(res,409,{error:'Strategie wurde inzwischen geändert. Neu laden und erneut prüfen.'});
      const next=strategy.normalize(input.document).document;
      next.mapping=strategy.validateMapping(input.mapping||input.document.mapping||{datasets:{},targets:{}},next,getConfig());
      strategy.validateImplementation(next,getConfig(),state,drive.snapshot());
      if(fs.existsSync(STRATEGY)){
        const directory=path.join(DATA,'strategy-backups');fs.mkdirSync(directory,{recursive:true,mode:0o700});
        saveJSON(path.join(directory,Date.now()+'-'+require('node:crypto').randomUUID()+'.json'),strategyDocument);
        for(const file of fs.readdirSync(directory).filter(file=>/^\d+-[a-f0-9-]+\.json$/.test(file)).sort().reverse().slice(10))fs.unlinkSync(path.join(directory,file));
      }
      saveJSON(STRATEGY,next);strategyDocument=next;
      return json(res,200,{success:true,revision:strategy.revision(next)});
    }
    if (req.method === 'GET' && url.pathname === '/api/updates') return json(res, 200, { installed: await updates.installed(), result: updates.current() });
    if (req.method === 'POST' && url.pathname === '/api/updates/check') return json(res, 200, await updates.check());
    if (req.method === 'GET' && url.pathname === '/api/diagnostics') return json(res, 200, diagnostics.current());
    if (req.method === 'POST' && url.pathname === '/api/diagnostics') return json(res, 202, diagnostics.start());
    if (req.method === 'POST' && url.pathname === '/api/auth') {
      const input = await body(req); configs.setAuth(input.enabled); auth.reset(req, res, configs.get().authEnabled);
      return json(res, 200, { success: true, authEnabled: configs.get().authEnabled });
    }
    if (req.method === 'POST' && url.pathname === '/api/notifications') {
      configs.setNotifications(await body(req)); return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') { auth.logout(req, res); return json(res, 200, { success: true }); }
    if (req.method === 'GET' && url.pathname === '/api/gdrive') return json(res, 200, { config: getConfig().gdrive, sources: getConfig().sources.filter(source=>!source.selection), timezone: getConfig().timezone, job: drive.snapshot() });
    if (req.method === 'POST' && url.pathname === '/api/gdrive') { configs.apply({ ...getConfig(), gdrive: await body(req) }); return json(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/gdrive/check') return json(res, 200, await drive.check());
    if (req.method === 'POST' && url.pathname === '/api/gdrive/start') { if (isMaintenance()) throw new Error('Update läuft.'); drive.start(); return json(res, 202, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/gdrive/verify') { if (isMaintenance()) throw new Error('Update läuft.'); drive.start(true); return json(res, 202, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/gdrive/cancel') { drive.cancel(); return json(res, 202, { success: true }); }
    if (req.method === 'GET' && url.pathname === '/api/activity') {
      const file = backups.active ? path.join(DATA, backups.active.folder + '.log') : null;
      return json(res, 200, { drive: drive.snapshot(), maintenance: isMaintenance(), health: Object.fromEntries(configs.get().sources.map(source => [source.id, scheduler.health(source.id)])), notification: state.notification || null, jobs: Object.fromEntries(configs.get().sources.map(source => [source.id, { ...(state.jobs[source.id] || { status: 'idle' }), estimate: estimateProgress(state.jobs[source.id]) }])), active: backups.active?.folder || null, phase: backups.active ? (backups.active.child ? 'backup' : 'checking') : 'idle', queue: backups.queue, paused: backups.paused, waitingReason: backups.waitingReason, backupPolicy: getConfig().backupPolicy, timezone: getConfig().timezone, log: file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
    }
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      sourceSizes.invalidate();
      return json(res, 202, { mounts: await mountStatus.read(getConfig().sources, true), discovery: await discovery.refresh(), sizeDeferred: backups.busy || isMaintenance() });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const snapshot = configs.get();
      const mounts = await mountStatus.read(snapshot.sources);
      const folders = snapshot.sources.map((source, index) => ({ ...source, targetRepository: repositoryFor(snapshot, source.target), ...mounts[index], pbsCheckAfter: state.pbsCheckAfter[source.target || 'primary'] || null, comparison: compareRuns(source, snapshot, state), job: state.jobs[source.id] || { status: 'idle' }, schedule: snapshot.schedules[source.id], health: healthFor(snapshot.schedules[source.id], snapshot.timezone, new Date(), state.watchSince[source.id], state.jobs[source.id], snapshot.staleAfterDays, state.triggered[source.id]) }));
      sourceSizes.retain(snapshot.sources);
      for (const folder of folders) folder.size = sourceSizes.read(folder, folder.ok);
      return json(res, 200, { system: { ...await system.inspect(), timezone: snapshot.timezone }, drive: drive.snapshot(), folders, capacities: { ...capacity.all(), gdrive: drive.capacity() }, timeline: createTimeline(snapshot, state), discovery: discovery.current(), targets: targetsFor(snapshot), connections: pbs.connections(), connection: pbs.lastConnection, config: configs.safe(snapshot), pbs: { checkedAt: pbs.current().checkedAt, count: pbs.current().count || 0, error: pbs.current().error || '' } });
    }
    if (req.method === 'POST' && url.pathname === '/api/capacity/refresh') { if (backups.busy || drive.busy || isMaintenance()) return json(res, 200, { capacities:{ ...capacity.all(), gdrive:drive.capacity() }, deferred:true }); await Promise.all(targetsFor(getConfig()).map(target=>capacity.refresh(target.id))); const google = await drive.refreshCapacity(); return json(res,200,{capacities:{ ...capacity.all(), gdrive:google }, deferred:Boolean(google.deferred)}); }
    if (req.method === 'GET' && url.pathname === '/api/planning') return json(res,200,planSuggestions(getConfig(),state));
    if (req.method === 'POST' && url.pathname === '/api/planning/apply') {
      const input=await body(req), plan=planSuggestions(getConfig(),state), suggestion=plan.suggestions.find(item=>item.id===input.id&&item.time===input.time);
      if(input.revision!==plan.revision||!suggestion) return json(res,409,{error:'Zeitplan oder Messwerte haben sich geändert. Vorschläge neu prüfen.'});
      configs.apply({...getConfig(),schedules:{...getConfig().schedules,[input.id]:{...getConfig().schedules[input.id],time:suggestion.time}}});return json(res,200,{success:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      configs.apply(await body(req));
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/queue') { const input = await body(req); backups.control(input.action, input.id, input.direction); return json(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/backup-policy') { configs.setPolicy(await body(req)); backups.tick(); return json(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/config/export') return json(res, 200, exportConfig(getConfig(), (await body(req)).includeSecrets ?? false));
    if (req.method === 'POST' && ['/api/config/restore/preview','/api/config/restore/apply'].includes(url.pathname)) {
      const input = await body(req), prepared = previewRestore(input.backup, getConfig());
      if (url.pathname.endsWith('/preview')) return json(res, 200, prepared.summary);
      if (input.revision !== revision(getConfig())) return json(res, 409, { error: 'Einstellungen haben sich geändert. Vorschau erneut laden.' });
      if (backups.busy || pbs.busy || capacity.busy) return json(res, 409, { error: 'Vor der Wiederherstellung alle Aufträge beenden.' });
      const backupFile = 'config-before-restore-' + Date.now() + '-' + require('node:crypto').randomUUID() + '.json';
      saveJSON(path.join(DATA, backupFile), getConfig());
      configs.apply(prepared.candidate, { replaceSecrets: true });
      return json(res, 200, { success: true, backupFile });
    }
    if (req.method === 'POST' && url.pathname === '/api/preferences') {
      const input = await body(req); configs.apply({ ...configs.get(), timezone: input.timezone, staleAfterDays: input.staleAfterDays });
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/targets') {
      const input = await body(req), changes = {};
      for (const key of ['repository','password','fingerprint','namespace','secondaryDatastore','secondaryPBS','additionalDatastores','capacityWarnPercent']) if (Object.hasOwn(input, key)) changes[key] = input[key];
      configs.apply({ ...configs.get(), ...changes });
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/targets/remove') { const input = await body(req); configs.removeTarget(input.target); return json(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/targets/setup') {
      const input = await body(req), current = configs.get();
      if (typeof input.datastore !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(input.datastore)) throw new Error('Ungültiger Datastore-Name.');
      let target;
      if (current.repository) {
        if (current.secondaryDatastore) {
          if (input.ownServer) throw new Error('Weitere Datastores auf PBS 1 sind möglich. Den eigenen PBS-Zugang unter Datastore 2 bearbeiten.');
          const entries = current.additionalDatastores || []; let slot=1; while(entries.some(item=>item.id==='extra'+slot)) slot++;
          target = 'extra'+slot; configs.apply({...current,additionalDatastores:[...entries,{id:target,datastore:input.datastore}]});
          return json(res,200,{success:true,target});
        }
        configs.apply({ ...current, secondaryDatastore: input.datastore, secondaryPBS: input.ownServer ? { server: input.server, authId: input.authId, password: input.password, fingerprint: input.fingerprint || '', namespace: input.namespace || '' } : null }); target = 'secondary';
      } else {
        if (typeof input.server !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(input.server) || typeof input.authId !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(input.authId) || typeof input.password !== 'string' || !input.password) throw new Error('PBS-Adresse, Benutzer und Passwort oder Token fehlen.');
        configs.apply({ ...current, repository: `${input.authId}@${input.server}:${input.datastore}`, password: input.password, fingerprint: input.fingerprint || '', namespace: input.namespace || '' }); target = 'primary';
      }
      return json(res, 200, { success: true, target });
    }
    const autoPreview=url.pathname.match(/^\/api\/partitions\/([a-z][a-z0-9_-]{0,39})\/preview$/);
    if(req.method==='POST'&&autoPreview){if(backups.busy||drive.busy||isMaintenance())throw Error('Ein Auftrag läuft.');const input=await body(req),listing=await partitions.list(autoPreview[1]);if(input.mapping)listing.folders=listing.folders.map(item=>({...item,target:input.mapping.find(value=>value.folder===item.name)?.target||''}));return json(res,200,await autoPartitions.plan(autoPreview[1],require('./lib/auto-partitions').validateAutoPartition(input.autoPartition),input.files||[],listing,{preview:true}));}
    const partitionRoute=url.pathname.match(/^\/api\/partitions\/([a-z][a-z0-9_-]{0,39})(\/restore)?$/);
    if(partitionRoute){
      const id=partitionRoute[1];
      if(req.method==='GET'&&!partitionRoute[2]) return json(res,200,await partitions.list(id));
      if(req.method==='POST'){const input=await body(req);if(input.confirmed!==true)throw new Error('Aufteilung ausdrücklich bestätigen.');return json(res,200,partitionRoute[2]?partitions.restore(id):await partitions.save(id,input.mapping,input.files,input.autoPartition));}
    }
    if (req.method === 'POST' && url.pathname === '/api/sources/probe') {
      const input = await body(req); return json(res, 200, await inspectPath(input.path, input.expectedSource || ''));
    }
    if (req.method === 'POST' && url.pathname === '/api/sources') {
      const input = await body(req); const current = configs.get();
      if (input.schedule && !input.sources?.some(source => source.id === input.schedule.id)) throw new Error('Zeitplan gehört zu keiner Quelle.');
      const driveSources = [...new Set([...current.gdrive.sources.filter(id => input.sources?.some(source => source.id === id)), ...(input.sources || []).filter(source => source.target === 'gdrive').map(source => source.id)])];
      const driveSchedule = input.schedule && input.sources.find(source => source.id === input.schedule.id)?.target === 'gdrive';
      configs.apply({ ...current, sources: input.sources, gdrive: { ...current.gdrive, sources: driveSources, ...(driveSchedule ? {schedule:input.schedule.value} : {}) }, schedules: input.schedule ? { ...current.schedules, [input.schedule.id]: driveSchedule ? '' : input.schedule.value } : current.schedules }); return json(res, 200, { success: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/pbs') return json(res, 200, pbs.current(url.searchParams.get('target') || 'primary'));
    if (req.method === 'POST' && url.pathname === '/api/pbs/refresh') return json(res, 200, await pbs.refresh(url.searchParams.get('target') || 'primary'));
    if (req.method === 'POST' && url.pathname === '/api/notifications/test') {
      await sendNotification(configs.get().notifications, 'Test von QNAP Backup Control: Benachrichtigungen funktionieren.');
      state.notification = { ok: true, at: new Date().toISOString(), message: 'Test zugestellt.' }; persist(); return json(res, 200, { success: true });
    }
    const restore = url.pathname.match(/^\/api\/restore\/([a-z][a-z0-9_-]{0,39})(\/refresh)?$/);
    if (restore && configs.sourceFor(restore[1]) && (req.method === 'GET' && !restore[2] || req.method === 'POST' && restore[2])) {
      const source = configs.sourceFor(restore[1]);
      if (restore[2]) await pbs.refresh(source.target || 'primary');
      return json(res, 200, restoreInfo(source, getConfig(), pbs.current(source.target || 'primary')));
    }
    const history = url.pathname.match(/^\/api\/history\/([a-z][a-z0-9_-]{0,39})(?:\/([a-f0-9-]{36}))?$/);
    if (req.method === 'GET' && history && configs.sourceFor(history[1])) {
      const entries = state.history[history[1]] || [];
      if (!history[2]) return json(res, 200, { entries, comparison: compareRuns(configs.sourceFor(history[1]), getConfig(), state) });
      if (!entries.some(entry => entry.runId === history[2])) return json(res, 404, { error: 'Protokoll nicht mehr im Verlauf.' });
      return json(res, 200, { log: fs.readFileSync(path.join(DATA, 'history', history[1], history[2] + '.log'), 'utf8') });
    }
    if (req.method === 'POST' && url.pathname === '/api/connection') return json(res, 200, await pbs.connection((await body(req)).target || 'primary'));
    if (req.method === 'POST' && url.pathname === '/api/backups/start') return json(res, 202, backups.enqueueAll());
    if (req.method === 'POST' && url.pathname === '/api/backups/cancel') { backups.cancelAll(); drive.cancel(); return json(res, 202, { success: true }); }
    const cancel = url.pathname.match(/^\/api\/backup\/([a-z][a-z0-9_-]{0,39})\/cancel$/);
    if (req.method === 'POST' && cancel) { backups.cancel(cancel[1]); return json(res, 202, { success: true }); }
    const backup = url.pathname.match(/^\/api\/backup\/([a-z][a-z0-9_-]{0,39})$/);
    if (req.method === 'POST' && backup) { backups.enqueue(backup[1], 'manual'); return json(res, 202, { success: true }); }
    if (req.method === 'GET' && url.pathname === '/api/logbook') return json(res,200,{entries:logbook.list()});
    if (req.method === 'GET' && url.pathname === '/api/logbook/content') return json(res,200,{log:logbook.read(url.searchParams.get('id'))});
    const logs = url.pathname.match(/^\/api\/logs\/([a-z][a-z0-9_-]{0,39})$/);
    if (req.method === 'GET' && logs && configs.sourceFor(logs[1])) {
      const file = path.join(DATA, logs[1] + '.log');
      return json(res, 200, { log: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'Noch kein Protokoll vorhanden.' });
    }
    json(res, 404, { error: 'Nicht gefunden.' });
  } catch (e) { json(res, e.status || 400, { error: e instanceof SyntaxError ? 'Ungültiges JSON.' : e.message, ...(e.field ? { field: e.field } : {}) }); }
});
void system.inspect().then(result => { for (const check of result.checks) if (!check.ok) console.warn(`HINWEIS ${check.name}: ${check.message}`); });
scheduler.start();
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} ist bereits belegt.` : `Webserver konnte nicht starten: ${error.code || 'unbekannter Fehler'}`); scheduler.stop(); process.exitCode = 1; });
server.listen(PORT, HOST, () => console.log(`QNAP Backup: http://${HOST}:${server.address().port}`));
function shutdown() {
  clearInterval(driveTimer); drive.stop(); clearInterval(capacityTimer); scheduler.stop(); sourceSizes.invalidate(); backups.stop();
  server.close(() => { if (!backups.active?.child && !drive.active) process.exit(0); });
  setTimeout(() => { backups.stop('SIGKILL'); drive.stop('SIGKILL'); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
