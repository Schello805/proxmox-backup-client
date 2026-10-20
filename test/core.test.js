'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountFor, validateConfig, scheduleKey, scheduleDue, normalizeSchedule, FOLDERS } = require('../core');
const base = { repository: 'backup@pbs@pbs:store', password: 'secret', fingerprint: '', namespace: '', schedules: Object.fromEntries(Object.keys(FOLDERS).map(id => [id, ''])) };
test('findet CIFS-Durchreichung und wählt den längsten Mountpfad', () => {
 const mounts = '1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 0:3 / /mnt/Daten rw - cifs //qnap/Daten rw\n3 2 8:2 / /mnt/Daten/Software/local rw - ext4 /dev/local rw';
 assert.equal(mountFor('/mnt/Daten/Software', mounts).type, 'cifs');
 assert.equal(mountFor('/mnt/Daten/Software/local/file', mounts).type, 'ext4');
 assert.equal(mountFor('/mnt/Daten2', mounts).type, 'ext4');
 assert.equal(mountFor('/mnt/Daten', mounts).target, '/mnt/Daten');
});
test('dekodiert Leerzeichen in Mountinfo und verwechselt keine Präfixe', () => {
 assert.equal(mountFor('/mnt/Meine Daten/Filme', '2 1 0:3 / /mnt/Meine\\040Daten rw - cifs //qnap/Meine\\040Daten rw').source, '//qnap/Meine Daten');
 assert.equal(mountFor('/mnt/Daten', ''), null);
});
test('Passwort bleibt erhalten, Konfiguration wird auf bekannte Felder begrenzt', () => {
 const result = validateConfig({ ...base, password: '', evil: 'value' }, base);
 assert.equal(result.password, 'secret'); assert.equal(result.evil, undefined);
});
test('ungültige Zeiten, Namespace und Steuerzeichen werden abgewiesen', () => {
 for (const change of [{ schedules: { ...base.schedules, filme: '24:00' } }, { namespace: '../wrong' }, { repository: 'server\nsecret' }, { fingerprint: 'wrong' }, { password: 'x\0y' }]) assert.throws(() => validateConfig({ ...base, ...change }, base));
});
test('Zeitplan verwendet Berlin und täglich dieselbe Kennung bei doppelter Stunde', () => {
 assert.deepEqual(scheduleKey(new Date('2026-10-20T11:15:00Z')), { day: '2026-10-20', time: '13:15', weekday: 2 });
 assert.deepEqual(scheduleKey(new Date('2026-10-25T00:30:00Z')), scheduleKey(new Date('2026-10-25T01:30:00Z')));
});

test('alte Tagespläne werden ohne Verlust in Wochenpläne umgewandelt', () => {
 assert.deepEqual(normalizeSchedule('02:30'), { days: [1,2,3,4,5,6,7], time: '02:30' });
 assert.deepEqual(normalizeSchedule(''), { days: [], time: '' });
});
test('Wochenplan startet nur an gewählten Berliner Tagen zur richtigen Zeit', () => {
 const plan = { days: [2,5], time: '13:15' }, now = scheduleKey(new Date('2026-10-20T11:15:00Z'));
 assert.equal(scheduleDue(plan, now), true);
 assert.equal(scheduleDue(plan, now, now.day), false);
 assert.equal(scheduleDue({ ...plan, days: [1,3] }, now), false);
 assert.equal(scheduleDue({ ...plan, time: '14:15' }, now), false);
 assert.equal(scheduleDue({ days: [], time: '' }, now), false);
 assert.equal(scheduleKey(new Date('2026-10-25T23:30:00Z')).weekday, 1);
});
test('Wochenpläne weisen ungültige Tage, Duplikate und fehlende Uhrzeiten ab', () => {
 for (const plan of [{ days:[0], time:'12:00' }, { days:[8],time:'12:00' }, { days:[1,1],time:'12:00' }, { days:['1'],time:'12:00' }, { days:[1],time:'' }, { days:[],time:'12:00' }, null]) assert.throws(() => normalizeSchedule(plan));
 assert.deepEqual(normalizeSchedule({ days:[7,1],time:'23:59' }), { days:[1,7],time:'23:59' });
});
