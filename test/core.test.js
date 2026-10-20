'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountFor, validateConfig, scheduleKey, FOLDERS } = require('../core');
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
 assert.deepEqual(scheduleKey(new Date('2026-10-20T11:15:00Z')), { day: '2026-10-20', time: '13:15' });
 assert.deepEqual(scheduleKey(new Date('2026-10-25T00:30:00Z')), scheduleKey(new Date('2026-10-25T01:30:00Z')));
});
