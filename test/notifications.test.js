'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { sendNotification } = require('../notifications');
test('ntfy: Topic, UTF-8-Text, Token und Fehler werden korrekt behandelt', async t => {
  let received, status = 200;
  const server = http.createServer(async (req,res) => { let text=''; for await (const chunk of req) text+=chunk; received={url:req.url,text,token:req.headers.authorization}; res.writeHead(status); res.end('{}'); });
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const config={enabled:true,url:`http://127.0.0.1:${server.address().port}/mein-topic`,token:'test-token'};
  await sendNotification(config,'Hörspiele: Backup fehlgeschlagen.');
  assert.deepEqual(received,{url:'/mein-topic',text:'Hörspiele: Backup fehlgeschlagen.',token:'Bearer test-token'});
  status=403; await assert.rejects(sendNotification(config,'Test'),/HTTP 403/);
  await assert.rejects(sendNotification({...config,enabled:false},'Test'),/nicht aktiviert/);
});
