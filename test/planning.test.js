'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultSources, validateSources, validateConfig, occurrence, scheduleWindow, scheduleKey, healthFor, mountIssue, parseSnapshots } = require('../core');
const blank = { repository: '', password: '', fingerprint: '', namespace: '', schedules: {} };
test('Migration ergänzt Daten und erhält alte Uhrzeiten und Standardzeitzone', () => {
  const config = validateConfig({ ...blank, schedules: { software: '02:30' } }, { password: '' });
  assert.equal(config.sources.length, 6); assert.equal(config.sources.find(source => source.id === 'daten').path, '/mnt/Daten/Daten');
  assert.deepEqual(config.schedules.software.days, [1,2,3,4,5,6,7]); assert.deepEqual(config.schedules.daten.days, []); assert.equal(config.timezone, 'Europe/Berlin');
});
test('Quellen sind dynamisch, eindeutig und auf den freigegebenen Bereich begrenzt', () => {
  const sources = [...defaultSources(), { id: 'fotos-2026', name: 'Fotos', path: '/mnt/Daten/Fotos', expectedSource: '//qnap/Meine Fotos' }];
  assert.equal(validateSources(sources).length, 7);
  for (const change of [{ id:'constructor' }, { id:'../x' }, { path:'/etc' }, { path:'/mnt/Daten/../secret' }, { path:'/mnt/Daten//Fotos' }, { path:'/mnt/Daten/Filme/Unterordner' }, { expectedSource:'not-smb' }]) assert.throws(() => validateSources([...defaultSources(), { ...sources[6], ...change }]));
  assert.throws(() => validateSources([sources[0],sources[0]]));
});
test('SMB-Identität wird vor dem Backup exakt geprüft', () => {
  assert.equal(mountIssue({ type:'cifs',source:'//qnap/Daten' }, '//qnap/Daten'), '');
  assert.match(mountIssue({ type:'cifs',source:'//anderes/Daten' }, '//qnap/Daten'), /stimmt nicht/);
  assert.match(mountIssue({ type:'ext4',source:'/dev/sda' }, ''), /Kein SMB/);
});
test('Planung beachtet wählbare Zeitzonen und validiert diese', () => {
  assert.equal(scheduleKey(new Date('2026-10-20T11:15:00Z'),'America/New_York').time, '07:15');
  assert.throws(() => validateConfig({ ...blank, timezone:'Mars/Test' }, { password:'' }));
  assert.throws(() => validateConfig({ ...blank, staleAfterDays:0 }, { password:'' }));
});
test('nächster und letzter Termin über Wochen- und Tagesgrenzen', () => {
  const plan = { days:[1,3,5],time:'02:30' };
  assert.deepEqual(scheduleWindow(plan,'Europe/Berlin',new Date('2026-10-20T11:00:00Z')), { nextAt:'2026-10-21T00:30:00.000Z', lastDueAt:'2026-10-19T00:30:00.000Z' });
  const sunday = scheduleWindow({ days:[7], time:'01:00' }, 'UTC', new Date('2026-10-25T00:30:00Z'));
  assert.equal(sunday.nextAt,'2026-10-25T01:00:00.000Z');
});
test('DST: keine erfundene Frühlingsstunde und nur ein Termin in doppelter Herbststunde', () => {
  assert.equal(occurrence('2026-03-29','02:30','Europe/Berlin'), null);
  assert.equal(new Date(occurrence('2026-10-25','02:30','Europe/Berlin')).toISOString(),'2026-10-25T00:30:00.000Z');
  assert.equal(scheduleWindow({ days:[7],time:'02:30' },'Europe/Berlin',new Date('2026-03-28T23:00:00Z')).nextAt,'2026-04-05T00:30:00.000Z');
  assert.equal(scheduleWindow({ days:[7],time:'02:30' },'Europe/Berlin',new Date('2026-10-25T01:00:00Z')).nextAt,'2026-11-01T01:30:00.000Z');
});
test('Verpasste Sicherung erst nach Beobachtungsbeginn und Schonfrist melden', () => {
  const plan = { days:[2],time:'02:00' }, since='2026-10-19T00:00:00Z';
  assert.equal(healthFor(plan,'UTC',new Date('2026-10-20T02:09:00Z'),since,{}).missed,false);
  assert.equal(healthFor(plan,'UTC',new Date('2026-10-20T02:11:00Z'),since,{}).missed,true);
  assert.equal(healthFor(plan,'UTC',new Date('2026-10-20T02:11:00Z'),'2026-10-20T02:05:00Z',{}).missed,false);
  assert.equal(healthFor(plan,'UTC',new Date('2026-10-20T02:11:00Z'),since,{ status:'running' }).missed,false);
  assert.equal(healthFor(plan,'UTC',new Date('2026-10-20T02:11:00Z'),since,{ lastSuccess:'2026-10-20T02:06:00Z' }).missed,false);
  assert.equal(healthFor({days:[],time:''},'UTC',new Date('2026-10-20T00:00:00Z'),since,{lastSuccess:'2026-10-01T00:00:00Z'},14).stale,true);
});
test('PBS-Snapshots inklusive älterer CLI-Gruppen werden strukturiert eingelesen', () => {
  const rows = parseSnapshots([{ 'backup-type':'host','backup-id':'software','backup-time':1792454400,size:1024,files:['software.pxar.didx'] },{ 'backup-type':'host','backup-id':'qnap-filme','backup-time':1792540800,files:[{filename:'qnap-filme.pxar.didx'}] }]);
  assert.equal(rows[0].group,'host/qnap-filme'); assert.equal(rows[1].files[0],'software.pxar.didx'); assert.equal(rows[1].size,1024);
  assert.throws(() => parseSnapshots({})); assert.throws(() => parseSnapshots([{'backup-id':'x'}]));
});
