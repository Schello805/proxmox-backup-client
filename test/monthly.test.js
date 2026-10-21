'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeSchedule,matchesDay,scheduleDue,scheduleKey,scheduleWindow,healthFor}=require('../lib/planning');
const {validateConfig}=require('../lib/validation');
const {migrateConfig}=require('../lib/storage');
const {createTimeline}=require('../lib/timeline');
const {createScheduler}=require('../lib/scheduler');
const plan=(monthDay=31,time='02:00')=>normalizeSchedule({days:[],time,monthDay});
test('Monthly validation preserves weekly shapes and rejects ambiguous or invalid month days',()=>{
 assert.deepEqual(plan(),{days:[],time:'02:00',monthDay:31});assert.deepEqual(normalizeSchedule({days:[1],time:'02:00'}),{days:[1],time:'02:00'});
 for(const monthDay of [0,32,1.5,null,'1','bad'])assert.throws(()=>plan(monthDay));assert.throws(()=>normalizeSchedule({days:[1],time:'02:00',monthDay:1}));assert.throws(()=>plan(1,''));
});
test('Monthly days clamp to month end, support leap years and run once per local calendar day',()=>{
 for(const[day,due]of[['2026-01-31',true],['2026-02-28',true],['2026-02-27',false],['2028-02-29',true],['2028-02-28',false],['2026-04-30',true],['2026-04-29',false]]){assert.equal(matchesDay(plan(),day),due,day);assert.equal(matchesDay(plan('last'),day),due,day);}
 const now=scheduleKey(new Date('2026-02-28T01:00:00Z'),'Europe/Berlin');assert.equal(scheduleDue(plan(),now),true);assert.equal(scheduleDue(plan(),now,now.day),false);
 const first=scheduleKey(new Date('2026-10-25T00:30:00Z'),'Europe/Berlin');assert.equal(scheduleDue(plan(25,'02:30'),first),true);assert.equal(scheduleDue(plan(25,'02:30'),first,first.day),false);
});
test('Monthly next and previous dates span year boundaries and skip nonexistent DST clock times',()=>{
 let dates=scheduleWindow(plan(1),'Europe/Berlin',new Date('2026-12-20T12:00:00Z'));assert.equal(dates.nextAt,'2027-01-01T01:00:00.000Z');assert.equal(dates.lastDueAt,'2026-12-01T01:00:00.000Z');
 dates=scheduleWindow(plan(29,'02:30'),'Europe/Berlin',new Date('2026-03-01T12:00:00Z'));assert.equal(dates.nextAt,'2026-04-29T00:30:00.000Z');assert.equal(dates.lastDueAt,'2026-02-28T01:30:00.000Z');
 dates=scheduleWindow(plan(),'Europe/Berlin',new Date('2026-02-01T12:00:00Z'));assert.equal(dates.nextAt,'2026-02-28T01:00:00.000Z');
});
test('Monthly schedules do not become stale before their next planned run',()=>{
 const p=plan(1),job={status:'success',lastSuccess:'2026-10-01T00:05:00Z'},watch='2026-09-01T00:00:00Z';
 let health=healthFor(p,'Europe/Berlin',new Date('2026-10-25T12:00:00Z'),watch,job,14);assert.equal(health.stale,false);assert.equal(health.missed,false);
 health=healthFor(p,'Europe/Berlin',new Date('2026-11-01T01:11:00Z'),watch,job,14);assert.equal(health.stale,true);assert.equal(health.missed,true);
});
test('Monthly scheduler enqueues exactly once and timeline displays clamped month end',()=>{
 const config=validateConfig({repository:'u@pbs@pbs:store',password:'secret',fingerprint:'',namespace:'',schedules:{software:plan()},authEnabled:false},{password:''}),state={jobs:{},history:{},triggered:{},watchSince:{}};
 const calls=[];let date=new Date('2026-02-28T01:00:00Z');const scheduler=createScheduler({getConfig:()=>config,state,persist(){},backups:{enqueue:id=>calls.push(id)},log(){},notify(){},clock:()=>date});scheduler.tick();scheduler.tick();assert.deepEqual(calls,['software']);
 const timeline=createTimeline(config,state,new Date('2026-02-25T12:00:00Z')),row=timeline.rows.find(row=>row.id==='software');assert.equal(row.manual,false);assert.equal(row.events.length,1);assert.equal(new Date(row.events[0].start).toISOString(),'2026-02-28T01:00:00.000Z');
 const previous={...config,schemaVersion:4};assert.deepEqual(migrateConfig(previous).schedules.software,plan());
});
