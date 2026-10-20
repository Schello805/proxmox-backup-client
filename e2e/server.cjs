'use strict';
// Test-only entry point: real HTTP server and application services, simulated NAS/PBS.
// Production server.js never imports this file and has no E2E environment switches.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
Object.assign(config, { repository: 'test@pbs@localhost:test-store', password: 'e2e-pbs-secret', authEnabled: true });
for (const source of config.sources) source.expectedSource = '//test-nas/' + source.id;
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(config));
const cp = require('node:child_process');
const realExecFile = cp.execFile;
cp.execFile = (file, args, options, callback) => {
  if (file === 'du') return setImmediate(() => process.env.E2E_SOURCE_SIZE === 'false' ? callback(new Error('Size unavailable')) : callback(null, `10737418240\t${args.at(-1)}\n`, ''));
  if (file === 'proxmox-backup-client') return setImmediate(() => callback(null, args[0] === 'version' ? 'test-client' : JSON.stringify([{ 'backup-type': 'host', 'backup-id': 'software', 'backup-time': 1792454400, files: ['qnap-software.pxar.didx'], size: 1024 }]), ''));
  return realExecFile(file, args, options, callback);
};
cp.execFile[require('node:util').promisify.custom] = (...args) => new Promise((resolve, reject) => cp.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
require('../lib/inspect').createInspector = () => async (target, expectedSource) => ({ ok: true, path: target, identityConfirmed: Boolean(expectedSource), error: '', mount: { source: expectedSource || '//test-nas/' + target.split('/').pop().toLowerCase(), target, type: 'cifs' } });
const realBackups = require('../lib/backups').createBackups;
let activeChild;
require('../lib/backups').createBackups = options => realBackups({ ...options, spawnProcess: () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = signal => { if (activeChild === child) { activeChild = null; child.emit('close', null, signal); } };
  activeChild = child;
  setImmediate(() => child.stdout.emit('data', Buffer.from('processed 5 GiB in 2min, uploaded 1 GiB\n')));
  return child;
} });
process.on('message', message => { if (message?.type === 'finish' && activeChild) { const child = activeChild; activeChild = null; child.emit('close', message.code, null); } });
require('../notifications').sendNotification = async () => {};
require('../lib/updates').createUpdates = () => ({
  installed: async () => ({ version: require('../package.json').version, commit: 'a'.repeat(40), modified: false }),
  current: () => null,
  check: async () => ({ status: 'available', message: 'Ein neuer Stand ist verfügbar.', checkedAt: new Date().toISOString(), latest: { version: '9.0.0', commit: 'b'.repeat(40), url: 'https://github.com/Schello805/proxmox-backup-client/commit/' + 'b'.repeat(40) } })
});
require('../server');
