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
let mountNumber = 10;
const actualMounts = new Map(config.sources.map(source => [source.path, { id: String(mountNumber++), device: '0:10', target: source.path, root: '/', type: 'cifs', source: source.expectedSource, bytes: 10737418240 }]));
process.on('message', message => {
  if (message?.type !== 'mount') return;
  const previous = actualMounts.get(message.path);
  actualMounts.set(message.path, { id: String(mountNumber++), device: '0:10', target: message.path, root: '/', type: 'cifs', bytes: 10737418240, ...previous, ...message.values, ...(message.values.source ? { id: String(mountNumber++) } : {}) });
  process.send({ ack: message.request });
});
const realDiscovery = require('../lib/discovery').createDiscovery;
require('../lib/discovery').createDiscovery = options => realDiscovery({ ...options, readMountinfo: async () => [...actualMounts.values()].map(mount => `${mount.id} 1 ${mount.device} ${mount.root} ${mount.target} rw - ${mount.type} ${mount.source} rw`).join('\n') });
const cp = require('node:child_process');
const realExecFile = cp.execFile;
cp.execFile = (file, args, options, callback) => {
  if (file === 'du') return setImmediate(() => process.env.E2E_SOURCE_SIZE === 'false' ? callback(new Error('Size unavailable')) : callback(null, `${actualMounts.get(args.at(-1))?.bytes ?? 10737418240}\t${args.at(-1)}\n`, ''));
  if (file === 'proxmox-backup-client') return setImmediate(() => callback(null, args[0] === 'version' ? 'test-client' : JSON.stringify([{ 'backup-type': 'host', 'backup-id': options.env?.PBS_REPOSITORY?.endsWith(':archive-store') ? 'daten' : 'software', 'backup-time': 1792454400, files: ['qnap-software.pxar.didx'], size: 1024 }]), ''));
  return realExecFile(file, args, options, callback);
};
cp.execFile[require('node:util').promisify.custom] = (...args) => new Promise((resolve, reject) => cp.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
require('../lib/inspect').createInspector = () => async (target, expectedSource) => {
  const mount = actualMounts.get(target) || { source: '//test-nas/' + target.split('/').pop().toLowerCase(), target, type: 'cifs' };
  const error = require('../lib/mounts').mountIssue(mount, expectedSource);
  return { ok: !error, path: target, identityConfirmed: Boolean(expectedSource && !error), error, mount: { ...mount } };
};
const realBackups = require('../lib/backups').createBackups;
let activeChild, activeJob;
require('../lib/backups').createBackups = options => realBackups({ ...options, spawnProcess: (_, args, spawnOptions) => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = signal => { if (activeChild === child) { activeChild = null; child.emit('close', null, signal); } };
  activeChild = child; activeJob = options.state.jobs[args[args.indexOf('--backup-id') + 1]];
  setImmediate(() => child.stdout.emit('data', Buffer.from(`E2E repository: ${spawnOptions.env.PBS_REPOSITORY}\nE2E namespace: ${spawnOptions.env.PBS_NAMESPACE}\nE2E credential match: ${spawnOptions.env.PBS_PASSWORD === (spawnOptions.env.PBS_REPOSITORY.includes('pbs2.local') ? 'e2e-second-secret' : 'e2e-pbs-secret')}\nprocessed 5 GiB in 2min, uploaded 1 GiB\n`)));
  return child;
} });
process.on('message', message => { if (message?.type === 'finish' && activeChild) { const child = activeChild; if (Number.isFinite(message.durationSeconds) && message.durationSeconds >= 0) activeJob.startedAt = new Date(Date.now() - message.durationSeconds * 1000).toISOString(); activeChild = null; child.emit('close', message.code, null); } });
require('../notifications').sendNotification = async () => {};
require('../lib/updates').createUpdates = () => ({
  installed: async () => ({ version: require('../package.json').version, commit: 'a'.repeat(40), modified: false }),
  current: () => null,
  check: async () => ({ status: 'available', message: 'Ein neuer Stand ist verfügbar.', checkedAt: new Date().toISOString(), latest: { version: '9.0.0', commit: 'b'.repeat(40), url: 'https://github.com/Schello805/proxmox-backup-client/commit/' + 'b'.repeat(40) } })
});
require('../server');
