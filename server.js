'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mountFor, mountIssue, validSourcePath, validateConfig, scheduleKey, scheduleDue, occurrence, healthFor, parseSnapshots } = require('./core');
const { sendNotification } = require('./notifications');
const run = promisify(execFile);
const ROOT = __dirname, DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const CONFIG = process.env.CONFIG_FILE || path.join(ROOT, 'config.json');
const HOST = process.env.HOST || '127.0.0.1', PORT = Number(process.env.PORT || 3000);
const PASS = process.env.APP_PASSWORD;
if (!PASS || PASS.length < 6) throw new Error('APP_PASSWORD mit mindestens 6 Zeichen setzen.');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
function save(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(file + '.tmp', 0o600); fs.renameSync(file + '.tmp', file);
}
if (!fs.existsSync(CONFIG) || !fs.readFileSync(CONFIG, 'utf8').trim()) save(CONFIG, JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'))));
let config = validateConfig(JSON.parse(fs.readFileSync(CONFIG)), { password: '' });
const STATE = path.join(DATA, 'state.json'), PBS_STATE = path.join(DATA, 'pbs.json');
let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : {};
for (const key of ['jobs','triggered','history','watchSince','alerted']) state[key] ||= {};
for (const source of config.sources) state.watchSince[source.id] ||= new Date().toISOString();
const sourceFor = id => config.sources.find(source => source.id === id);
const persist = () => save(STATE, state);
const readLog = id => fs.existsSync(path.join(DATA, id + '.log')) ? fs.readFileSync(path.join(DATA, id + '.log'), 'utf8') : '';
function redact(text) { for (const secret of [config.password, config.notifications.token, PASS]) if (secret) text = text.split(secret).join('[ausgeblendet]'); return text; }
function log(id, text) { fs.writeFileSync(path.join(DATA, id + '.log'), Buffer.from(readLog(id) + redact(text)).subarray(-256 * 1024), { mode: 0o600 }); }
function archive(id, job) {
  if (!job.endedAt) return;
  job.runId ||= crypto.randomUUID(); state.history[id] ||= [];
  if (state.history[id].some(entry => entry.runId === job.runId)) return;
  const dir = path.join(DATA, 'history', id); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, job.runId + '.log'), readLog(id), { mode: 0o600 });
  state.history[id].unshift({ runId: job.runId, startedAt: job.startedAt || null, endedAt: job.endedAt, status: job.status, source: job.source || 'unknown', error: job.error || '', exitCode: job.exitCode ?? null, durationSeconds: job.startedAt ? Math.max(0, Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000)) : null, path: job.path || sourceFor(id)?.path, repository: job.repository || '', namespace: job.namespace || '' });
  for (const old of state.history[id].splice(10)) fs.rmSync(path.join(dir, old.runId + '.log'), { force: true });
}
for (const [id, job] of Object.entries(state.jobs)) {
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id)) continue;
  if (['running','queued'].includes(job.status)) { job.status = 'interrupted'; job.endedAt = new Date().toISOString(); job.error = 'Dienst wurde während des Auftrags beendet.'; }
  archive(id, job);
}
persist();
const queue = [];
let active = null, stopping = false, notificationChain = Promise.resolve();
function notify(key, message) {
  if (!config.notifications.enabled || state.alerted[key]) return;
  state.alerted[key] = new Date().toISOString();
  const entries = Object.entries(state.alerted); if (entries.length > 1000) state.alerted = Object.fromEntries(entries.slice(-500));
  persist();
  const settings = { ...config.notifications };
  notificationChain = notificationChain.then(async () => {
    try { await sendNotification(settings, message); state.notification = { ok: true, at: new Date().toISOString(), message: 'Meldung zugestellt.' }; }
    catch { state.notification = { ok: false, at: new Date().toISOString(), message: 'ntfy-Zustellung fehlgeschlagen. URL, Token und Netzwerk prüfen.' }; }
    persist();
  });
}
function environment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PBS_')) delete env[key];
  return { ...env, PBS_REPOSITORY: config.repository, PBS_PASSWORD: config.password, PBS_FINGERPRINT: config.fingerprint, PBS_NAMESPACE: config.namespace };
}
async function inspectPath(target, expectedSource = '') {
  if (!validSourcePath(target)) throw new Error('Quellpfad muss unter /mnt/Daten/ liegen.');
  try {
    const mounts = await fs.promises.readFile('/proc/self/mountinfo', 'utf8');
    const { stdout } = await run(process.execPath, ['-e', "const fs=require('fs');const p=process.argv[1];if(!fs.statSync(p).isDirectory())process.exit(1);const d=fs.opendirSync(p);d.closeSync();process.stdout.write(fs.realpathSync(p));", target], { timeout: 8000, maxBuffer: 16384 });
    if (!validSourcePath(stdout)) return { ok: false, path: target, error: 'Der tatsächliche Pfad liegt außerhalb des erlaubten Quellenbereichs.' };
    const mount = mountFor(stdout, mounts), error = mountIssue(mount, expectedSource);
    return { ok: !error, path: target, mount, error, identityConfirmed: Boolean(expectedSource && !error) };
  } catch (e) { return { ok: false, path: target, error: e.killed ? 'SMB-Prüfung hat das Zeitlimit überschritten.' : 'Pfad nicht lesbar oder Mount-Prüfung fehlgeschlagen.' }; }
}
const inspectFolder = id => inspectPath(sourceFor(id).path, sourceFor(id).expectedSource);
function configured() { return Boolean(config.repository && config.password); }
function health(id, now = new Date()) { return healthFor(config.schedules[id], config.timezone, now, state.watchSince[id], state.jobs[id], config.staleAfterDays, state.triggered[id]); }
function enqueue(id, source) {
  if (!sourceFor(id)) throw new Error('Unbekannter Auftrag.');
  if (!configured()) throw new Error('Zuerst PBS-Repository und Passwort konfigurieren.');
  if (['running','queued'].includes(state.jobs[id]?.status)) throw new Error('Auftrag läuft bereits oder wartet.');
  state.jobs[id] = { ...state.jobs[id], status: 'queued', error: '', source, runId: crypto.randomUUID(), startedAt: null, endedAt: null, exitCode: null };
  fs.writeFileSync(path.join(DATA, id + '.log'), 'Auftrag wartet auf Ausführung.\n', { mode: 0o600 });
  queue.push(id); persist(); void drain();
}
async function drain() {
  if (active || stopping || !queue.length) return;
  const id = queue.shift(), source = sourceFor(id); active = { folder: id, child: null };
  const job = state.jobs[id]; Object.assign(job, { status: 'running', runId: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null, exitCode: null, path: source.path, repository: config.repository, namespace: config.namespace });
  fs.writeFileSync(path.join(DATA, id + '.log'), '', { mode: 0o600 });
  log(id, `${job.startedAt} · Prüfe ${source.path}\n`); persist();
  const mount = await inspectFolder(id); if (stopping) return;
  if (!mount.ok) { finish(id, null, mount.error); return; }
  log(id, `SMB eingebunden: ${mount.mount.source} → ${mount.mount.target} (${mount.mount.type})\nBackup startet …\n`);
  const child = spawn('proxmox-backup-client', ['backup', `qnap-${id}.pxar:${source.path}`, '--backup-type', 'host', '--backup-id', id, '--crypt-mode', 'none'], { env: environment(), stdio: ['ignore','pipe','pipe'] });
  active.child = child; let error = '';
  child.stdout.on('data', data => log(id, data.toString())); child.stderr.on('data', data => log(id, data.toString()));
  child.on('error', e => { error = e.code === 'ENOENT' ? 'proxmox-backup-client ist nicht installiert.' : 'Backup-Prozess konnte nicht gestartet werden.'; });
  child.on('close', (code, signal) => finish(id, code, error || (signal ? `Prozess durch ${signal} beendet.` : code === 0 ? '' : `Backup fehlgeschlagen (Exit-Code ${code}).`)));
}
function finish(id, code, error) {
  const job = state.jobs[id]; job.status = !error && code === 0 ? 'success' : 'failed';
  job.error = error; job.exitCode = code; job.endedAt = new Date().toISOString();
  if (job.status === 'success') job.lastSuccess = job.endedAt;
  log(id, `\n${job.endedAt} · ${error || 'Backup erfolgreich.'}\n`); archive(id, job); persist();
  if (error) notify(`run/${job.runId}`, `${sourceFor(id).name}: Backup fehlgeschlagen. Details in Backup Control prüfen.`);
  active = null; void drain();
}
function applyConfig(input) {
  if (active || queue.length) throw new Error('Konfiguration erst nach Ende aller Aufträge ändern.');
  if (pbsRequest) throw new Error('PBS-Abfrage läuft noch. Bitte kurz warten.');
  const next = validateConfig(input, config), now = new Date().toISOString();
  for (const source of next.sources) {
    const old = sourceFor(source.id), targetChanged = config.repository !== next.repository || config.namespace !== next.namespace;
    const pathChanged = old && old.path !== source.path;
    if (!old || config.timezone !== next.timezone || targetChanged || pathChanged || JSON.stringify(config.schedules[source.id]) !== JSON.stringify(next.schedules[source.id])) state.watchSince[source.id] = now;
    if (!old || targetChanged || pathChanged) state.jobs[source.id] = { status: 'idle' };
  }
  save(CONFIG, next); config = next; lastConnection = null; persist();
}
let lastConnection = null;
let pbs = fs.existsSync(PBS_STATE) ? JSON.parse(fs.readFileSync(PBS_STATE)) : { snapshots: [], checkedAt: null };
const pbsKey = () => `${config.repository}\n${config.namespace}`;
function currentPBS() { return pbs.key === pbsKey() ? pbs : { snapshots: [], checkedAt: null, error: '' }; }
let pbsRequest = null;
async function refreshPBS() {
  if (!configured()) throw new Error('PBS-Zugang fehlt.');
  if (pbsRequest) return pbsRequest;
  const key = pbsKey(), env = environment();
  pbsRequest = (async () => {
    try {
      const { stdout } = await run('proxmox-backup-client', ['snapshot','list','--output-format','json'], { env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
      const snapshots = parseSnapshots(JSON.parse(stdout));
      pbs = { key, snapshots: snapshots.slice(0,5000), count: snapshots.length, checkedAt: new Date().toISOString(), error: '' }; save(PBS_STATE, pbs);
      lastConnection = { ok: true, checkedAt: pbs.checkedAt, message: 'PBS erreichbar. Snapshot-Bestand wurde gelesen.' };
    } catch (e) {
      const message = e.code === 'ENOENT' ? 'Backup Client fehlt.' : 'PBS-Abfrage fehlgeschlagen. Zugang, Rechte, Fingerprint und Netzwerk prüfen.';
      pbs = { ...currentPBS(), key, error: message, attemptedAt: new Date().toISOString() }; save(PBS_STATE, pbs);
      lastConnection = { ok: false, checkedAt: pbs.attemptedAt, message };
    }
    return pbs;
  })().finally(() => pbsRequest = null);
  return pbsRequest;
}
async function connection() { await refreshPBS(); return lastConnection; }
let systemCache;
async function system() {
  if (systemCache) return { ...systemCache, timezone: config.timezone };
  let version = 'Nicht verfügbar', debian = os.release();
  try { version = (await run('proxmox-backup-client', ['version'], { timeout: 5000 })).stdout.trim(); } catch {}
  try { debian = (await fs.promises.readFile('/etc/os-release', 'utf8')).match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || debian; } catch {}
  systemCache = { hostname: os.hostname(), platform: debian, client: version }; return { ...systemCache, timezone: config.timezone };
}
function safeConfig(snapshot = config) { return { ...snapshot, password: '', hasPassword: Boolean(snapshot.password), notifications: { ...snapshot.notifications, token: '', hasToken: Boolean(snapshot.notifications.token) } }; }
const expectedPassword = crypto.createHash('sha256').update(PASS).digest();
const sessions = new Map(), attempts = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('qnap_session='))?.slice(13);
}
function authorized(req) {
  const token = sessionToken(req), expires = sessions.get(token);
  if (!expires || expires <= Date.now()) { if (token) sessions.delete(token); return false; }
  return true;
}
function cookie(req, token, age) {
  return `qnap_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${req.socket.encrypted || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 65536) throw new Error('Anfrage zu groß.'); }
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
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (req.method === 'GET' && assets[url.pathname]) {
      const [file, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', file)));
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const now = Date.now(), ip = req.socket.remoteAddress;
      for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
      for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
      const attempt = attempts.get(ip) || { count: 0, until: now + 60000 };
      if (attempt.count >= 10) return json(res, 429, { error: 'Zu viele Versuche. Bitte in einer Minute erneut versuchen.' });
      const input = await body(req);
      if (typeof input.password !== 'string' || !crypto.timingSafeEqual(expectedPassword, crypto.createHash('sha256').update(input.password).digest())) {
        attempt.count++; if (attempts.size < 1000 || attempts.has(ip)) attempts.set(ip, attempt);
        return json(res, 401, { error: 'Das Passwort stimmt nicht.' });
      }
      attempts.delete(ip);
      if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, now + SESSION_MS);
      res.setHeader('Set-Cookie', cookie(req, token, SESSION_MS / 1000));
      return json(res, 200, { success: true });
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Nicht gefunden.' });
    if (!authorized(req)) return json(res, 401, { error: 'Bitte anmelden.' });
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      sessions.delete(sessionToken(req)); res.setHeader('Set-Cookie', cookie(req, '', 0));
      return json(res, 200, { success: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/activity') {
      const file = active ? path.join(DATA, active.folder + '.log') : null;
      return json(res, 200, { health: Object.fromEntries(config.sources.map(source => [source.id, health(source.id)])), notification: state.notification || null, jobs: Object.fromEntries(config.sources.map(source => [source.id, state.jobs[source.id] || { status: 'idle' }])), active: active?.folder || null, phase: active ? (active.child ? 'backup' : 'checking') : 'idle', queue: [...queue], log: file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const snapshot = config;
      const folders = await Promise.all(snapshot.sources.map(async source => ({ ...source, ...(await inspectPath(source.path, source.expectedSource)), job: state.jobs[source.id] || { status: 'idle' }, schedule: snapshot.schedules[source.id], health: healthFor(snapshot.schedules[source.id], snapshot.timezone, new Date(), state.watchSince[source.id], state.jobs[source.id], snapshot.staleAfterDays, state.triggered[source.id]) })));
      return json(res, 200, { system: { ...await system(), timezone: snapshot.timezone }, folders, connection: lastConnection, config: safeConfig(snapshot), pbs: { checkedAt: currentPBS().checkedAt, count: currentPBS().count || 0, error: currentPBS().error || '' } });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      applyConfig(await body(req));
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/sources/probe') {
      const input = await body(req); return json(res, 200, await inspectPath(input.path, input.expectedSource || ''));
    }
    if (req.method === 'POST' && url.pathname === '/api/sources') {
      const input = await body(req); applyConfig({ ...config, sources: input.sources }); return json(res, 200, { success: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/pbs') return json(res, 200, currentPBS());
    if (req.method === 'POST' && url.pathname === '/api/pbs/refresh') return json(res, 200, await refreshPBS());
    if (req.method === 'POST' && url.pathname === '/api/notifications/test') {
      await sendNotification(config.notifications, 'Test von QNAP Backup Control: Benachrichtigungen funktionieren.');
      state.notification = { ok: true, at: new Date().toISOString(), message: 'Test zugestellt.' }; persist(); return json(res, 200, { success: true });
    }
    const history = url.pathname.match(/^\/api\/history\/([a-z][a-z0-9_-]{0,39})(?:\/([a-f0-9-]{36}))?$/);
    if (req.method === 'GET' && history && sourceFor(history[1])) {
      const entries = state.history[history[1]] || [];
      if (!history[2]) return json(res, 200, { entries });
      if (!entries.some(entry => entry.runId === history[2])) return json(res, 404, { error: 'Protokoll nicht mehr im Verlauf.' });
      return json(res, 200, { log: fs.readFileSync(path.join(DATA, 'history', history[1], history[2] + '.log'), 'utf8') });
    }
    if (req.method === 'POST' && url.pathname === '/api/connection') return json(res, 200, await connection());
    const backup = url.pathname.match(/^\/api\/backup\/([a-z][a-z0-9_-]{0,39})$/);
    if (req.method === 'POST' && backup) { enqueue(backup[1], 'manual'); return json(res, 202, { success: true }); }
    const logs = url.pathname.match(/^\/api\/logs\/([a-z][a-z0-9_-]{0,39})$/);
    if (req.method === 'GET' && logs && sourceFor(logs[1])) {
      const file = path.join(DATA, logs[1] + '.log');
      return json(res, 200, { log: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'Noch kein Protokoll vorhanden.' });
    }
    json(res, 404, { error: 'Nicht gefunden.' });
  } catch (e) { json(res, 400, { error: e instanceof SyntaxError ? 'Ungültiges JSON.' : e.message }); }
});
function tick() {
  if (stopping) return;
  const date = new Date(), now = scheduleKey(date, config.timezone);
  for (const source of config.sources) {
    const id = source.id;
    if (scheduleDue(config.schedules[id], now, state.triggered[id]) && occurrence(now.day, now.time, config.timezone) === Math.floor(date.getTime() / 60000) * 60000) {
      state.triggered[id] = now.day; persist();
      try { enqueue(id, 'schedule'); } catch (e) { log(id, `\n${date.toISOString()} · Zeitplan übersprungen: ${e.message}\n`); }
    }
    const status = health(id, date);
    if (status.missed) notify(`missed/${id}/${status.lastDueAt}`, `${source.name}: Geplanter Backup-Termin ohne Erfolg. Bitte Backup Control prüfen.`);
    if (status.stale) notify(`stale/${id}/${state.jobs[id].lastSuccess}`, `${source.name}: Letzter Backup-Erfolg liegt mehr als ${config.staleAfterDays} Tage zurück.`);
  }
}
const timer = setInterval(tick, 10000);
server.listen(PORT, HOST, () => console.log(`QNAP Backup: http://${HOST}:${server.address().port}`));
function shutdown() {
  stopping = true; clearInterval(timer);
  if (active?.child) active.child.kill('SIGTERM');
  server.close(() => { if (!active?.child) process.exit(0); });
  setTimeout(() => { active?.child?.kill('SIGKILL'); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
