'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRcloneOutput,redactRclone}=require('../lib/rclone-log');
test('Rclone-Ausgabe trennt Statistik und konkrete Fehler, verarbeitet Teilzeilen und beide Streams',()=>{
 const lines=[],errors=[],stats=[];const output=createRcloneOutput({log:line=>lines.push(line),onError:error=>errors.push(error),onStats:value=>stats.push(value)});
 output.push(Buffer.from('{"level":"notice","stats":{"bytes":42},"msg":"stats"}\n'),'stderr');
 output.push(Buffer.from('{"level":"error","object":"Ordner/Film.mkv",'),'stderr');
 output.push(Buffer.from('plain stdout\n'),'stdout');output.push(Buffer.from('"msg":"Failed to copy: googleapi: Error 403: storageQuotaExceeded"}'),'stderr');output.end();
 assert.equal(stats.length,1);assert.equal(lines.length,2);assert.match(errors[0],/Film.mkv.*storageQuotaExceeded/);
 assert.ok(!lines.join('').includes('"bytes"'));
});
test('Rclone-Protokoll blendet bekannte Geheimnisse, OAuth-Token und Bearer-Zugänge aus',()=>{
 const text=redactRclone('known-secret Authorization: Bearer abc123.foo access_token=abc&x=ok "refresh_token":"one two" client_secret=mysecret ya29.ABCD', ['known-secret']);
 for(const secret of ['known-secret','abc123.foo','abc&','one two','mysecret','ya29.ABCD'])assert.ok(!text.includes(secret));
 assert.match(text,/ausgeblendet/);assert.match(text,/x=ok/);
});
test('Überlange Protokollzeilen werden vollständig verworfen, nächste Fehlermeldung bleibt lesbar',()=>{
 const lines=[];const output=createRcloneOutput({log:line=>lines.push(line)});
 output.push(Buffer.from('x'.repeat(70000)));output.push(Buffer.from('secret-tail\nERROR: permission denied\n'));output.end();
 assert.ok(!lines.join('').includes('secret-tail'));assert.match(lines.join(''),/permission denied/);assert.ok(lines.join('').length<1000);
});
