'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { FOLDERS, mountFor, validateConfig, scheduleKey } = require('./core');
const run = promisify(execFile);
const ROOT = __dirname, DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const CONFIG = process.env.CONFIG_FILE || path.join(ROOT, 'config.json');
const HOST = process.env.HOST || '127.0.0.1', PORT = Number(process.env.PORT || 3000);
const USER = process.env.APP_USER || 'admin', PASS = process.env.APP_PASSWORD;
if (!PASS || PASS.length < 12) throw new Error('APP_PASSWORD mit mindestens 12 Zeichen setzen.');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
function save(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(file + '.tmp', 0o600);
  fs.renameSync(file + '.tmp', file);
}
if (!fs.existsSync(CONFIG) || !fs.readFileSync(CONFIG, 'utf8').trim()) save(CONFIG, JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'))));
let config = validateConfig(JSON.parse(fs.readFileSync(CONFIG)), { password: '' });
const STATE = path.join(DATA, 'state.json');
let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : { jobs: {}, triggered: {} };
for (const job of Object.values(state.jobs)) if (['running', 'queued'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Dienst wurde während des Auftrags beendet. Vor erneutem Start auf verbliebene Prozesse prüfen.'; }
save(STATE, state);
const queue = [];
let active = null, stopping = false;
function persist() { save(STATE, state); }
function log(folder, text) {
  const file = path.join(DATA, folder + '.log');
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const safe = config.password ? text.split(config.password).join('[ausgeblendet]') : text;
  fs.writeFileSync(file, (old + safe).slice(-256 * 1024), { mode: 0o600 });
}
function environment() {
  const env = { ...process.env };
  // Keine geerbten PBS-Einstellungen verwenden, die das konfigurierte Ziel überschreiben.
  for (const key of Object.keys(env)) if (key.startsWith('PBS_')) delete env[key];
  return { ...env, PBS_REPOSITORY: config.repository, PBS_PASSWORD: config.password, PBS_FINGERPRINT: config.fingerprint, PBS_NAMESPACE: config.namespace };
}
async function inspectFolder(folder) {
  const target = FOLDERS[folder];
  try {
    const mounts = await fs.promises.readFile('/proc/self/mountinfo', 'utf8');
    const { stdout } = await run(process.execPath, ['-e', "const fs=require('fs');const p=process.argv[1];if(!fs.statSync(p).isDirectory())process.exit(1);const d=fs.opendirSync(p);d.closeSync();process.stdout.write(fs.realpathSync(p));", target], { timeout: 8000, maxBuffer: 16384 });
    const real = stdout;
    const mount = mountFor(real, mounts);
    if (!mount || !['cifs', 'smb3'].includes(mount.type)) return { ok: false, path: target, mount, error: 'Kein SMB/CIFS-Dateisystem unter diesem Pfad. Backup gesperrt.' };
    return { ok: true, path: target, mount };
  } catch (e) { return { ok: false, path: target, error: e.killed ? 'SMB-Prüfung hat das Zeitlimit überschritten.' : 'Pfad nicht lesbar oder Mount-Prüfung fehlgeschlagen.' }; }
}
function configured() { return Boolean(config.repository && config.password); }
function enqueue(folder, source) {
  if (!FOLDERS[folder]) throw new Error('Unbekannter Auftrag.');
  if (!configured()) throw new Error('Zuerst PBS-Repository und Passwort konfigurieren.');
  if (['running', 'queued'].includes(state.jobs[folder]?.status)) throw new Error('Auftrag läuft bereits oder wartet.');
  state.jobs[folder] = { ...state.jobs[folder], status: 'queued', error: '', source };
  queue.push(folder); persist(); void drain();
}
async function drain() {
  if (active || stopping || !queue.length) return;
  const folder = queue.shift();
  active = { folder, child: null };
  const job = state.jobs[folder];
  job.status = 'running'; job.startedAt = new Date().toISOString(); job.endedAt = null; job.exitCode = null;
  fs.writeFileSync(path.join(DATA, folder + '.log'), '', { mode: 0o600 });
  log(folder, `${job.startedAt} · Prüfe ${FOLDERS[folder]}\n`); persist();
  const mount = await inspectFolder(folder);
  if (stopping) return;
  if (!mount.ok) { finish(folder, null, mount.error); return; }
  log(folder, `SMB eingebunden: ${mount.mount.target} (${mount.mount.type})\nBackup startet …\n`);
  const child = spawn('proxmox-backup-client', ['backup', `qnap-${folder}.pxar:${FOLDERS[folder]}`, '--backup-type', 'host', '--backup-id', folder, '--crypt-mode', 'none'], { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  active.child = child;
  let error = '';
  child.stdout.on('data', data => log(folder, data.toString()));
  child.stderr.on('data', data => log(folder, data.toString()));
  child.on('error', e => { error = e.code === 'ENOENT' ? 'proxmox-backup-client ist nicht installiert.' : 'Backup-Prozess konnte nicht gestartet werden.'; });
  child.on('close', (code, signal) => finish(folder, code, error || (signal ? `Prozess durch ${signal} beendet.` : code === 0 ? '' : `Backup fehlgeschlagen (Exit-Code ${code}).`)));
}
function finish(folder, code, error) {
  const job = state.jobs[folder];
  job.status = !error && code === 0 ? 'success' : 'failed';
  job.error = error; job.exitCode = code; job.endedAt = new Date().toISOString();
  if (job.status === 'success') job.lastSuccess = job.endedAt;
  log(folder, `\n${job.endedAt} · ${error || 'Backup erfolgreich.'}\n`);
  persist(); active = null; void drain();
}
let lastConnection = null;
async function connection() {
  if (!configured()) throw new Error('PBS-Zugang fehlt.');
  try {
    await run('proxmox-backup-client', ['snapshot', 'list', '--output-format', 'json'], { env: environment(), timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    lastConnection = { ok: true, checkedAt: new Date().toISOString(), message: 'Repository erreichbar; Anmeldung und Snapshot-Abfrage erfolgreich.' };
  } catch (e) {
    lastConnection = { ok: false, checkedAt: new Date().toISOString(), message: e.code === 'ENOENT' ? 'Backup Client fehlt.' : 'Verbindung fehlgeschlagen. Repository, Rechte, Passwort und Fingerprint prüfen.' };
  }
  return lastConnection;
}
let systemCache;
async function system() {
  if (systemCache) return systemCache;
  let version = 'Nicht verfügbar', debian = os.release();
  try { version = (await run('proxmox-backup-client', ['version'], { timeout: 5000 })).stdout.trim(); } catch {}
  try { debian = (await fs.promises.readFile('/etc/os-release', 'utf8')).match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || debian; } catch {}
  return systemCache = { hostname: os.hostname(), platform: debian, client: version, timezone: 'Europe/Berlin' };
}
const expectedAuth = crypto.createHash('sha256').update(`${USER}:${PASS}`).digest();
function authorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  return crypto.timingSafeEqual(expectedAuth, crypto.createHash('sha256').update(Buffer.from(header.slice(6), 'base64')).digest());
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) throw new Error('Anfrage zu groß.'); }
  return JSON.parse(text);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="QNAP Backup", charset="UTF-8"' }); res.end('Anmeldung erforderlich'); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Fremder Ursprung.' });
      if (req.headers['x-requested-with'] !== 'qnap-dashboard') return json(res, 403, { error: 'Anfrage-Header fehlt.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const folders = await Promise.all(Object.keys(FOLDERS).map(async id => ({ id, ...(await inspectFolder(id)), job: state.jobs[id] || { status: 'idle' }, schedule: config.schedules[id] })));
      return json(res, 200, { system: await system(), folders, connection: lastConnection, config: { ...config, password: '', hasPassword: Boolean(config.password) } });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      if (active || queue.length) throw new Error('Konfiguration erst nach Ende aller Aufträge ändern.');
      config = validateConfig(await body(req), config); save(CONFIG, config); lastConnection = null;
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/connection') return json(res, 200, await connection());
    const backup = url.pathname.match(/^\/api\/backup\/([a-z]+)$/);
    if (req.method === 'POST' && backup) { enqueue(backup[1], 'manual'); return json(res, 202, { success: true }); }
    const logs = url.pathname.match(/^\/api\/logs\/([a-z]+)$/);
    if (req.method === 'GET' && logs && FOLDERS[logs[1]]) {
      const file = path.join(DATA, logs[1] + '.log');
      return json(res, 200, { log: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'Noch kein Protokoll vorhanden.' });
    }
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (req.method === 'GET' && assets[url.pathname]) {
      const [file, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', file)));
    }
    json(res, 404, { error: 'Nicht gefunden.' });
  } catch (e) { json(res, 400, { error: e instanceof SyntaxError ? 'Ungültiges JSON.' : e.message }); }
});
const timer = setInterval(() => {
  if (stopping) return;
  const { day, time } = scheduleKey();
  for (const folder of Object.keys(FOLDERS)) {
    if (config.schedules[folder] !== time || state.triggered[folder] === day) continue;
    state.triggered[folder] = day; persist();
    try { enqueue(folder, 'schedule'); } catch (e) { log(folder, `\n${new Date().toISOString()} · Zeitplan übersprungen: ${e.message}\n`); }
  }
}, 10000);
server.listen(PORT, HOST, () => console.log(`QNAP Backup: http://${HOST}:${server.address().port}`));
function shutdown() {
  stopping = true; clearInterval(timer);
  if (active?.child) active.child.kill('SIGTERM');
  server.close(() => { if (!active?.child) process.exit(0); });
  setTimeout(() => { active?.child?.kill('SIGKILL'); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
