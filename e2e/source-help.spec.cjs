const {test,expect,login}=require('./fixtures.cjs');
test('Quellenhilfe funktioniert per Klick und Tastatur ohne Formulareingaben zu verändern',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});await page.locator('#manageSources').click();
 const form=page.locator('#sourceForm');await form.getByLabel('Name',{exact:true}).fill('Daten');
 const help=form.getByRole('button',{name:'Hilfe: Pfad im LXC',exact:true});
 const labelBox=await form.locator('label[for=source-field-path]').boundingBox(),helpBox=await help.boundingBox();expect(helpBox.x-labelBox.x-labelBox.width).toBeLessThan(12);expect(Math.abs(helpBox.y-labelBox.y)).toBeLessThan(8);
 await help.click();
 await expect(page.locator('#source-help-path')).toBeVisible();await expect(page.locator('#source-help-path')).toContainText('/mnt/Daten/Daten');
 await help.press('Escape');await expect(page.locator('#source-help-path')).toBeHidden();
 await form.getByRole('button',{name:'Hilfe: Backup-ID',exact:true}).focus();await expect(page.locator('#source-help-id')).toBeVisible();
 await form.getByLabel('Name',{exact:true}).focus();await expect(page.locator('#source-help-id')).toBeHidden();await expect(form.getByLabel('Name',{exact:true})).toHaveValue('Daten');
 await page.setViewportSize({width:390,height:844});await help.click();await expect(page.locator('#source-help-path')).toBeVisible();
 await form.screenshot({path:testInfo.outputPath('source-help-mobile.png')});
});

test('Google Drive ist als Quellenziel wählbar, bleibt gespeichert und erstellt keinen PBS-Auftrag',async({page})=>{
 await login(page,{sourceDetails:false});await page.locator('#manageSources').click();
 const form=page.locator('#sourceForm');
 await expect(form.getByLabel('Backup-Ziel',{exact:true}).locator('option[value=gdrive]')).toHaveText(/Google Drive/);
 await page.locator('#sourceList tr[data-source-id=daten]').getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await form.getByLabel('Backup-Ziel',{exact:true}).selectOption('gdrive');await expect(page.locator('#sourceTargetHint')).toBeVisible();
 await form.getByRole('button',{name:'Quelle speichern',exact:true}).click();await expect(page.locator('#sourceResult')).toContainText('gespeichert');
 let data=await (await page.request.get('/api/status')).json();expect(data.config.sources.find(s=>s.id==='daten').target).toBe('gdrive');expect(data.config.gdrive.sources).toContain('daten');expect(data.config.schedules.daten.time).toBe('');
 const attempt=await page.request.post('/api/backup/daten');expect(attempt.ok()).toBe(false);
 await page.reload();await page.locator('#manageSources').click();await page.locator('#sourceList tr[data-source-id=daten]').getByRole('button',{name:'Bearbeiten',exact:true}).click();await expect(form.getByLabel('Backup-Ziel',{exact:true})).toHaveValue('gdrive');
 await page.getByRole('link',{name:/Aufträge$/}).click();await expect(page.locator('#folders tr[data-folder=daten]')).toHaveCount(0);
});
