const {test,expect,login}=require('./fixtures.cjs');
const fixture=require('../test/strategy-fixture.cjs');
const headers={'X-Requested-With':'qnap-dashboard'};
async function importPlanner(page){
 await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('link',{name:/Backup-Planung$/}).click();await page.getByRole('button',{name:'Planner importieren',exact:true}).click();
 await page.locator('#plannerFile').setInputFiles({name:'planner.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
 await page.locator('#plannerPreview').click();await expect(page.locator('#plannerPreviewResult')).toContainText('2 aktive Pläne');
}
test('Planner-Import hat Vorschau, explizite Zuordnung und verändert keine ausführbaren Aufträge',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});const before=(await(await page.request.get('/api/status')).json()).config;
 await importPlanner(page);await expect(page.locator('#plannerPreviewResult')).toContainText('inaktive/gelöschte');
 let current=await(await page.request.get('/api/strategy')).json();expect(current.document.data.plans).toHaveLength(0);
 await page.locator('#plannerMappingDetails>summary').click();await page.locator('#plannerImportMapping').getByLabel('Zuordnung Dokumente',{exact:true}).selectOption('software');await page.locator('#plannerImportMapping').getByLabel('Zuordnung Plan-PBS',{exact:true}).selectOption('primary');
 await page.locator('#plannerApply').click();await expect(page.locator('#plannerPreviewResult')).toContainText('Übernahme bestätigen');
 await page.locator('#plannerConfirm').check();await page.locator('#plannerApply').click();await expect(page.locator('#strategyFeedback')).toContainText('Planner importiert');
 expect((await(await page.request.get('/api/status')).json()).config).toEqual(before);
 await expect(page.locator('#strategyPaths')).toContainText('Dokumente');await expect(page.locator('#strategyPaths')).toContainText('App-Auftrag verbunden');
 await page.reload();await expect(page.locator('#strategyPaths')).toContainText('Dokumente');
 const exported=(await(await page.request.get('/api/strategy')).json()).document;await page.getByRole('button',{name:'Planner importieren',exact:true}).click();await page.locator('#plannerFile').setInputFiles({name:'strategy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await page.locator('#plannerPreview').click();await expect(page.locator('#plannerImportMapping').getByLabel('Zuordnung Dokumente',{exact:true})).toHaveValue('software');await page.locator('#strategyImportClose').click();
 await page.screenshot({path:testInfo.outputPath('strategy-paths-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Backup-Pläne',exact:true}).click();await expect(page.locator('#planningPlanList tbody tr')).toHaveCount(2);await expect(page.locator('#planningPlanList tbody tr').first().getByRole('button',{name:'Bearbeiten',exact:true})).toBeVisible();
 await page.getByRole('link',{name:/Aufträge$/}).click();await expect(page.locator('#externalJobRows')).toHaveCount(0);await expect(page.locator('#jobCount')).toHaveText('6');await expect(page.locator('#jobsTable')).not.toContainText('Dokumente in die Cloud');
 await page.locator('#jobManagement').selectOption('pbs');await expect(page.locator('#folders tr:visible')).toHaveCount(6);
 await page.locator('#jobSearch').fill('Cloud');await expect(page.locator('#folders tr:visible')).toHaveCount(0);
 await page.getByRole('link',{name:/Zeitplan$/}).click();await expect(page.locator('#calendarFilter')).toHaveValue('operating');await expect(page.locator('#unifiedCalendar .calendar-external')).toHaveCount(0);await page.locator('#calendarFilter').selectOption('planned');await expect(page.locator('#unifiedCalendar .calendar-bar')).not.toHaveCount(0);await page.locator('#calendarAgenda').click();await expect(page.locator('#unifiedCalendar .agenda-row')).not.toHaveCount(0);
 await page.locator('#calendarFilter').selectOption('planned');await expect(page.locator('#unifiedCalendar')).toContainText('Dokumente in die Cloud');
 await page.locator('#calendarWeek').click();await page.screenshot({path:testInfo.outputPath('strategy-calendar.png'),fullPage:true});
});
test('Externe Pläne und Stammdaten lassen sich ohne Modal bearbeiten; verknüpfte Geräte bleiben geschützt',async({page},testInfo)=>{
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));await login(page,{sourceDetails:false});await importPlanner(page);await page.locator('#plannerConfirm').check();await page.locator('#plannerApply').click();await expect(page.locator('#strategyFeedback')).toContainText('Planner importiert');
 await page.getByRole('button',{name:'Neuer Backup-Plan',exact:false}).first().click();const editor=page.locator('#strategyEditor');await expect(editor).toBeVisible();
 await editor.getByLabel('Name',{exact:true}).fill('Monatliche Dokumente');await editor.getByLabel('Frequenz',{exact:true}).selectOption('monthly');await editor.getByLabel('Monatstag',{exact:true}).selectOption('last');await editor.getByLabel('Dokumente',{exact:true}).check();await editor.getByRole('button',{name:'Plan speichern',exact:true}).click();await expect(editor).toBeHidden();
 await page.getByRole('button',{name:'Geräte & Standorte',exact:true}).click();await page.locator('#strategyInventory').getByRole('button',{name:'Entfernen',exact:true}).first().click();await editor.getByRole('button',{name:'Entfernen bestätigen',exact:true}).click();await expect(editor).toContainText('Standort');
 await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'+ Eintrag',exact:true}).click();await editor.getByLabel('Name',{exact:true}).fill('Außenstandort');await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();await expect(page.locator('#strategyInventory')).toContainText('Außenstandort');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('strategy-inventory-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Import verweigert alte Revision und ungültige Referenzen; bestehende Strategie bleibt erhalten',async({page})=>{
 await login(page,{sourceDetails:false});const current=await(await page.request.get('/api/strategy')).json(),document=fixture();
 let res=await page.request.post('/api/strategy/import',{headers,data:{document,mapping:{datasets:{},targets:{}},revision:current.revision}});expect(res.ok()).toBe(true);
 res=await page.request.post('/api/strategy/import',{headers,data:{document,mapping:{datasets:{},targets:{}},revision:current.revision}});expect(res.status()).toBe(409);
 document.data.plans[0].target_id='unknown';res=await page.request.post('/api/strategy/preview',{headers,data:{document}});expect(res.ok()).toBe(false);expect((await(await page.request.get('/api/strategy')).json()).document.data.plans).toHaveLength(2);
});

test('Backup-Planung ersetzt den Planner: Stammdaten und Plan ohne Import anlegen, bearbeiten und entfernen',async({page})=>{
 await login(page,{sourceDetails:false});const before=(await(await page.request.get('/api/status')).json()).config;
 await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('link',{name:/Backup-Planung$/}).click();await page.getByRole('button',{name:'Geräte & Standorte',exact:true}).click();
 const editor=page.locator('#strategyEditor');
 async function add(kind,name,fill){await page.locator('#inventoryKind').selectOption(kind);await page.locator('#inventoryAdd').click();await editor.getByLabel('Name',{exact:true}).fill(name);if(fill)await fill();await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();}
 await add('locations','Teststandort');
 await add('sources','Testgerät',async()=>{await editor.getByLabel('Standort',{exact:true}).selectOption({label:'Teststandort'});});
 await add('targets','Testziel',async()=>{await editor.getByLabel('Speichertyp',{exact:true}).selectOption('cloud');await editor.getByLabel('Unveränderliche Sicherung möglich',{exact:true}).check();});
 await add('datasets','Testfotos',async()=>{await editor.getByLabel('Ursprüngliches Quellgerät',{exact:true}).selectOption({label:'Testgerät'});});
 await add('software','Rclone');
 await page.getByRole('button',{name:'Backup-Pläne',exact:true}).click();await page.locator('#planningPlanAdd').click();await editor.getByLabel('Name',{exact:true}).fill('Fotos zur Cloud');await editor.getByLabel('Software (optional)',{exact:true}).selectOption({label:'Rclone'});await editor.getByLabel('Frequenz',{exact:true}).selectOption('weekly');await editor.getByLabel('Mo',{exact:true}).check();await editor.getByLabel('Testfotos',{exact:true}).check();await editor.getByRole('button',{name:'Plan speichern',exact:true}).click();await expect(editor).toBeHidden();
 await page.reload();await page.getByRole('button',{name:'Backup-Pläne',exact:true}).click();let row=page.locator('#planningPlanList tbody tr');await expect(row).toContainText('Fotos zur Cloud');await row.getByRole('button',{name:'Bearbeiten',exact:true}).click();await expect(editor.getByLabel('Software (optional)',{exact:true})).toHaveValue((await(await page.request.get('/api/strategy')).json()).document.data.software[0].id);await editor.getByLabel('Name',{exact:true}).fill('Fotos wöchentlich');await editor.getByRole('button',{name:'Plan speichern',exact:true}).click();await expect(row).toContainText('Fotos wöchentlich');
 await row.getByRole('button',{name:'Entfernen',exact:true}).click();await editor.getByRole('button',{name:'Entfernen bestätigen',exact:true}).click();await expect(editor).toBeHidden();await expect(row).toHaveCount(0);
 expect((await(await page.request.get('/api/status')).json()).config).toEqual(before);
});
