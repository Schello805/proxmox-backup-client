const {test,expect,login}=require('./fixtures.cjs');
const fs=require('node:fs');
const headers={'X-Requested-With':'qnap-dashboard'};
test('Queue can be paused after current backup, reordered, trimmed and resumed',async({page,app})=>{
 await login(page);await page.getByRole('button',{name:'Alle PBS-Aufträge starten',exact:true}).click();if(!(await page.locator('#queueDetails').evaluate(node=>node.open)))await page.locator('#queueSummary').click();
 await page.getByRole('button',{name:'Nach diesem Backup pausieren',exact:true}).click();
 await page.getByRole('button',{name:'Serien: Nach oben',exact:true}).click();await page.getByRole('button',{name:'Hörspiele: Entfernen',exact:true}).click();
 let data=await(await page.request.get('/api/activity')).json();expect(data.active).toBe('software');expect(data.queue).toEqual(['serien','filme','musik','daten']);expect(data.paused).toBe(true);
 app.finish();await expect(page.locator('#activityTitle')).toHaveText('Warteschlange pausiert');expect((await(await page.request.get('/api/activity')).json()).active).toBe(null);
 await page.getByRole('button',{name:'Fortsetzen',exact:true}).click();await expect(page.locator('[data-folder="serien"] .job-state')).toContainText('Läuft');
 await page.getByRole('button',{name:'Alle abbrechen',exact:true}).click();
});
test('Start window defers manual jobs; policy can be changed with waiting jobs and applies client rate',async({page})=>{
 await login(page);const config=(await(await page.request.get('/api/status')).json()).config;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).split(':').map(Number),minutes=parts[0]*60+parts[1];
 const time=offset=>{const value=(minutes+offset)%1440;return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');};
 await page.locator('a[data-page="settings"]').click();await page.locator('#policySettings summary').click();const form=page.locator('#policyForm');await form.getByLabel('Neue Backups nur im Startfenster starten').check();await form.getByLabel('Von',{exact:true}).fill(time(120));await form.getByLabel('Bis',{exact:true}).fill(time(180));await form.getByLabel('PBS-Upload-Limit (MiB/s)',{exact:true}).fill('10');await form.getByRole('button',{name:'Backup-Regeln speichern'}).click();await expect(page.locator('#policyResult')).toContainText('Gespeichert');
 const start=await page.request.post('/api/backup/software',{headers,data:{}});expect(start.ok()).toBe(true);expect((await(await page.request.get('/api/activity')).json()).active).toBe(null);
 await form.getByLabel('Neue Backups nur im Startfenster starten').uncheck();await form.getByRole('button',{name:'Backup-Regeln speichern'}).click();await expect.poll(async()=>(await(await page.request.get('/api/activity')).json()).active).toBe('software');
 await expect.poll(async()=>(await(await page.request.get('/api/logs/software')).json()).log).toContain('E2E rate: 10485760');
 await page.request.post('/api/backups/cancel',{headers,data:{}});
});
test('Settings export defaults to no secrets; restore previews changes, detects stale preview and applies safely',async({page},testInfo)=>{
 await login(page);await page.locator('a[data-page="settings"]').click();await page.locator('#transferSettings summary').click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Einstellungen exportieren',exact:true}).click();const file=await download,backup=JSON.parse(fs.readFileSync(await file.path(),'utf8'));expect(backup.config.password).toBe('');expect(backup.includesSecrets).toBe(false);
 const initial=(await(await page.request.get('/api/status')).json()).config;backup.config.timezone='UTC';
 await page.locator('#restoreFile').setInputFiles({name:'einstellungen.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.getByRole('button',{name:'Wiederherstellung prüfen',exact:true}).click();await expect(page.locator('#restorePreview')).toContainText('Zeitzone');expect((await(await page.request.get('/api/status')).json()).config.timezone).toBe(initial.timezone);
 const pendingPreview=await(await page.request.post('/api/config/restore/preview',{headers,data:{backup}})).json();await page.request.post('/api/backup/software',{headers,data:{}});expect((await page.request.post('/api/config/restore/apply',{headers,data:{backup,revision:pendingPreview.revision}})).status()).toBe(409);await page.request.post('/api/backups/cancel',{headers,data:{}});
 await page.request.post('/api/backup-policy',{headers,data:{rateMiB:5}});await page.getByRole('button',{name:'Wiederherstellen',exact:true}).click();await expect(page.locator('#restoreResult')).toContainText('Vorschau erneut');
 await page.getByRole('button',{name:'Wiederherstellung prüfen',exact:true}).click();await page.screenshot({path:testInfo.outputPath('restore-preview.png'),fullPage:true});await page.getByRole('combobox',{name:'Zeitzone',exact:true}).selectOption('America/New_York');await page.getByRole('button',{name:'Wiederherstellen',exact:true}).click();await expect(page.locator('#restoreResult')).toContainText('Vorheriger Stand gesichert');
 const config=(await(await page.request.get('/api/status')).json()).config;expect(config.timezone).toBe('UTC');await expect(page.getByRole('combobox',{name:'Zeitzone',exact:true})).toHaveValue('UTC');expect(config.hasPassword).toBe(true);expect(config.authEnabled).toBe(true);
 await page.getByLabel('Zugangsdaten im Klartext mit exportieren').check();const secretDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Einstellungen exportieren',exact:true}).click();const secret=JSON.parse(fs.readFileSync(await(await secretDownload).path(),'utf8'));expect(secret.config.password).toBe('e2e-pbs-secret');
});
test('Source details compare successful runs, expose upload metrics and retain history',async({page,app},testInfo)=>{
 await login(page);const row=page.locator('[data-folder="software"]');for(const seconds of [60,120]){await row.getByRole('button',{name:'Starten',exact:true}).click();await expect(page.locator('#activityMeta')).toContainText('5 GiB');app.finish(0,seconds);await expect(row.locator('.job-state')).toContainText('Erfolgreich');}
 await row.getByRole('button',{name:'Software',exact:true}).click();await expect(page.locator('#historyMetrics')).toContainText('+100 %');await expect(page.locator('#historyMetrics')).toContainText('Upload (Client)');await expect(page.locator('#historyRows tr')).toHaveCount(2);await expect(page.locator('#historyRows')).toContainText('1 GiB');await page.screenshot({path:testInfo.outputPath('run-comparison.png'),fullPage:true});
});
