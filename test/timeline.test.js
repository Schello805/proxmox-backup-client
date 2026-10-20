'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTimeline, lastDuration } = require('../lib/timeline');
const { validateConfig } = require('../lib/validation');
function fixture() { return validateConfig({ repository: 'backup@pbs@pbs.local:store', password: 'test', fingerprint: '', namespace: '', timezone: 'Europe/Berlin', schedules: {}, authEnabled: false }, { password: '' }); }
function success(config, id, overrides = {}) { const source = config.sources.find(source => source.id === id); return { status: 'success', path: source.path, repository: config.repository, namespace: '', startedAt: '2026-10-19T20:00:00Z', endedAt: '2026-10-19T22:00:00Z', durationSeconds: 7200, ...overrides }; }

test('Gantt nutzt nur die letzte erfolgreiche Dauer derselben Quelle am gleichen Ziel', () => {
  const config = fixture(), source = config.sources[0];
  const state = { jobs: { software: { status: 'running' } }, history: { software: [success(config,'software',{status:'failed',endedAt:'2026-10-20T00:00:00Z'}),success(config,'software',{path:'/mnt/Daten/Other',endedAt:'2026-10-20T00:00:00Z'}),success(config,'software',{repository:'other@pbs@pbs.local:store',endedAt:'2026-10-20T00:00:00Z'}),success(config,'software',{namespace:'other',endedAt:'2026-10-20T00:00:00Z'}),success(config,'software')] } };
  assert.deepEqual(lastDuration(source,config,state),{seconds:7200,endedAt:'2026-10-19T22:00:00Z'});
  assert.equal(lastDuration(source,config,{jobs:{software:{status:'failed'}}}),null);
  assert.equal(lastDuration(source,config,{jobs:{software:success(config,'software',{durationSeconds:undefined})}}).seconds,7200);
  assert.equal(lastDuration(source,config,{history:{software:[success(config,'software',{durationSeconds:-1})]}}),null);
});

test('Gantt zeigt ohne Messung nur Startpunkte und keine erfundene Dauer', () => {
  const config=fixture();config.schedules.software={days:[1,2,3,4,5,6,7],time:'02:00'};
  const timeline=createTimeline(config,{jobs:{},history:{}},new Date('2026-10-20T08:00:00Z'));
  assert.equal(timeline.rows[0].events.length,7);assert.equal(timeline.rows[0].duration,null);assert.ok(timeline.rows[0].events.every(event=>event.end===null));
  assert.equal(timeline.rows[1].manual,true);assert.equal(timeline.rows[1].events.length,0);assert.equal(timeline.days.length,7);
});

test('Gantt berücksichtigt Zeitumstellung: 25-Stunden-Tag und nur erste doppelte Uhrzeit', () => {
  const config=fixture();config.schedules.software={days:[7],time:'02:30'};
  const timeline=createTimeline(config,{history:{software:[success(config,'software')]}},new Date('2026-10-24T08:00:00Z'));
  const day=timeline.days.find(day=>day.day==='2026-10-25');assert.equal(day.end-day.start,25*3600000);
  const event=timeline.rows[0].events.find(event=>event.start>=day.start&&event.start<day.end);assert.equal(new Date(event.start).toISOString(),'2026-10-25T00:30:00.000Z');assert.equal(event.end-event.start,7200000);
  const spring=createTimeline(config,{jobs:{}},new Date('2026-03-28T08:00:00Z'));assert.equal(spring.rows[0].events.length,0);
});

test('Gantt behält über Mitternacht reichende Balken und kennzeichnet Überschneidungen', () => {
  const config=fixture();config.schedules.software={days:[1],time:'23:30'};config.schedules.filme={days:[2],time:'00:30'};
  const timeline=createTimeline(config,{history:{software:[success(config,'software')],filme:[success(config,'filme')]}},new Date('2026-10-20T00:00:00Z'));
  const first=timeline.rows[0].events[0],second=timeline.rows[1].events[0];assert.ok(first.start<timeline.start&&first.end>timeline.start);assert.equal(first.overlap,true);assert.equal(second.overlap,true);
});

test('Gantt verwirft Dauer nach Wechsel des zweiten PBS oder seines Namespace', () => {
  const config=fixture();config.secondaryDatastore='archive';config.secondaryPBS={server:'pbs2.local',authId:'other@pbs',password:'other',fingerprint:'',namespace:'archive'};config.sources[0].target='secondary';
  const state={history:{software:[success(config,'software',{repository:'other@pbs@pbs2.local:archive',namespace:'archive'})]}};
  assert.equal(lastDuration(config.sources[0],config,state).seconds,7200);config.secondaryPBS.namespace='changed';assert.equal(lastDuration(config.sources[0],config,state),null);
});
