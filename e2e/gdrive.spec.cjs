'use strict';
const {test,expect,login}=require('./fixtures.cjs');
test('Google Drive einrichten, Monatsplan speichern, prüfen, kopieren und abbrechen',async({page},testInfo)=>{
  await login(page);await page.getByRole('link',{name:/Backup-Ziele$/}).click();
  const panel=page.locator('#drivePanel');await expect(panel.getByLabel('Rclone-Remote')).toHaveValue('gdrive');
  await panel.getByLabel('Daten',{exact:true}).check();await panel.getByLabel('Frequenz',{exact:true}).selectOption('monthly');await panel.getByLabel('Monatstag',{exact:true}).selectOption('last');await panel.getByLabel('Uhrzeit',{exact:true}).fill('04:15');
  await panel.getByRole('button',{name:'Google Drive speichern',exact:true}).click();await expect(page.locator('#driveResult')).toContainText('gespeichert');
  await panel.getByRole('button',{name:'Google Drive prüfen',exact:true}).click();await expect(page.locator('#driveResult')).toContainText('Google Drive erreichbar');
  await page.reload();await expect(panel.getByLabel('Frequenz',{exact:true})).toHaveValue('monthly');await expect(panel.getByLabel('Monatstag',{exact:true})).toHaveValue('last');await expect(panel.getByLabel('Daten',{exact:true})).toBeChecked();
  await page.locator('#drivePanel').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('google-drive.png'),fullPage:true});
  await page.locator('#driveStart').click();await expect(page.locator('#driveStatus')).toHaveText('Läuft');await expect(page.locator('#drivePercent')).toHaveText('50 %');
  const busyExport=await page.request.post('/api/config/export',{headers:{'X-Requested-With':'qnap-dashboard'},data:{includeSecrets:false}});expect(busyExport.ok()).toBe(true);expect(JSON.stringify(await busyExport.json())).not.toContain('rclone.conf');
  const queued=await page.request.post('/api/backup/software',{headers:{'X-Requested-With':'qnap-dashboard'},data:{}});expect(queued.ok()).toBe(true);const state=await(await page.request.get('/api/activity')).json();expect(state.jobs.software.status).toBe('queued');
  await page.locator('#driveCancel').click();await expect(page.locator('#driveStatus')).toHaveText('Abgebrochen');await expect(page.locator('#driveHistory')).toContainText('Abgebrochen');await page.request.post('/api/backups/cancel',{headers:{'X-Requested-With':'qnap-dashboard'},data:{}});
});
test('Google-Drive-Kopie bleibt bei falscher SMB-Zuordnung gesperrt',async({page,app})=>{
  await login(page);await page.getByRole('link',{name:/Backup-Ziele$/}).click();await page.locator('#drivePanel').getByLabel('Daten',{exact:true}).check();await page.getByRole('button',{name:'Google Drive speichern',exact:true}).click();await expect(page.locator('#driveResult')).toContainText('gespeichert');
  await app.setMount('/mnt/Daten/Daten',{source:'//test-nas/software'});await page.locator('#driveStart').click();await expect(page.locator('#driveStatus')).toHaveText('Fehlgeschlagen');await expect(page.locator('#driveMessage')).toContainText(/SMB|Freigabe|Quelle/);await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
