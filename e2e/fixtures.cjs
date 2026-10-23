'use strict';
const { test: base, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = base.extend({
  sourceSize: [true, { option: true }],
  app: async ({ sourceSize }, use) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qnap-browser-'));
    const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', APP_PASSWORD: '123456', CONFIG_FILE: path.join(directory, 'config.json'), DATA_DIR: directory, E2E_SOURCE_SIZE: String(sourceSize) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let diagnostics = ''; child.stderr.on('data', data => { diagnostics += data; });
    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('E2E-Serverstart überschritten: ' + diagnostics)), 10_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('E2E-Server beendet: ' + code + ' ' + diagnostics)); });
        child.stdout.on('data', data => { const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      });
      await use({ url, setCapacity:(datastore,value)=>new Promise((resolve,reject)=>{const request=require('node:crypto').randomUUID();const handler=message=>{if(message.ack===request){clearTimeout(timer);child.off('message',handler);resolve();}};const timer=setTimeout(()=>{child.off('message',handler);reject(Error('Capacity fixture timeout'));},3000);child.on('message',handler);child.send({type:'capacity',request,datastore,value});}), setPartitionEntries: (mountPath,entries)=>new Promise((resolve,reject)=>{const request=require('node:crypto').randomUUID();const handler=message=>{if(message.ack===request){clearTimeout(timer);child.off('message',handler);resolve();}};const timer=setTimeout(()=>{child.off('message',handler);reject(Error('Partition fixture timeout'));},3000);child.on('message',handler);child.send({type:'partition-entries',request,path:mountPath,entries});}), failDrive:()=>child.send({type:'drive-fail'}), notifications: () => new Promise((resolve,reject) => { const request=require('node:crypto').randomUUID();const handler=message=>{if(message.ack===request){clearTimeout(timer);child.off('message',handler);resolve(message.messages);}};const timer=setTimeout(()=>{child.off('message',handler);reject(Error('Notification snapshot timeout'));},3000);child.on('message',handler);child.send({type:'notifications',request});}), finish: (code = 0, durationSeconds) => child.send({ type: 'finish', code, durationSeconds }), setMount: (mountPath, values) => new Promise((resolve, reject) => {
        const request = require('node:crypto').randomUUID();
        const handler = message => { if (message.ack === request) { clearTimeout(timer); child.off('message', handler); resolve(); } };
        const timer = setTimeout(() => { child.off('message', handler); reject(new Error('Mount-Teststeuerung überschritten')); }, 3000);
        child.on('message', handler); child.send({ type: 'mount', request, path: mountPath, values });
      }) });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited; clearTimeout(timer);
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  baseURL: async ({ app }, use) => use(app.url),
  page: async ({ page }, use) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await use(page); expect(errors).toEqual([]);
  }
});
// Operation tests open the jobs page; dashboard tests use sourceDetails:false.
async function login(page, { sourceDetails = true } = {}) {
  await page.goto('/'); await page.getByLabel('Passwort', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await expect(page.locator('#loginDialog')).not.toBeVisible();
  await expect(page.locator('#folders tr')).toHaveCount(6);
  if (sourceDetails) await page.getByRole('link',{name:/Aufträge$/}).click();
  if (sourceDetails) for (const id of ['sourceOverviewDetails','overviewPlan']) if ((await page.locator('#'+id).getAttribute('open')) === null) await page.locator('#'+id+'>summary').click();
}
module.exports = { test, expect, login };
