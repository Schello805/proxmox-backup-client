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
 await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('#strategyInventory').getByRole('button',{name:'Entfernen',exact:true}).first().click();await expect(editor).toContainText('Untergeordneter Standort · Serverraum');await expect(editor.getByRole('button',{name:'Zuordnungen lösen und Standort entfernen',exact:true})).toBeVisible();
 await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.locator('#inventoryAdd').click();await editor.getByLabel('Name',{exact:true}).fill('Außenstandort');await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();await expect(page.locator('#strategyInventory')).toContainText('Außenstandort');
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
 await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('link',{name:/Backup-Planung$/}).click();await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();
 const editor=page.locator('#strategyEditor');
 async function add(kind,name,fill){await page.locator(`[data-inventory-kind="${kind}"]`).click();await page.locator('#inventoryAdd').click();await editor.getByLabel('Name',{exact:true}).fill(name);if(fill)await fill();await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();}
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

test('Mehrere dokumentierte Daten und Ziele laden; alle Planungsbereiche erlauben neue Einträge',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await login(page,{sourceDetails:false});const current=await(await page.request.get('/api/strategy')).json(),document=fixture();
 document.data.datasets.push({id:'movies',name:'Filme geplant',source_id:'nas'});
 document.data.targets.push({id:'pbs3',name:'Datastore pbs3',device_id:'nas'});
 const response=await page.request.post('/api/strategy/import',{headers,data:{document,mapping:{datasets:{},targets:{}},revision:current.revision}});expect(response.ok()).toBe(true);
 await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('link',{name:/Backup-Planung$/}).click();
 await expect(page.locator('#strategyPaths')).toContainText('Filme geplant');
 await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();
 const editor=page.locator('#strategyEditor');
 for(const kind of ['sources','datasets','targets','locations','software','networks']){
  await page.locator(`[data-inventory-kind="${kind}"]`).click();await page.locator('#inventoryAdd').click();
  await expect(editor.getByLabel('Name',{exact:true})).toBeVisible();await editor.getByRole('button',{name:'Schließen',exact:true}).click();
 }
 await page.locator('[data-inventory-kind="targets"]').click();await expect(page.locator('#strategyInventory')).toContainText('Datastore pbs3');await expect(page.locator('#strategyInventory')).toContainText('Plan-Cloud');
 await page.locator('[data-inventory-kind="datasets"]').click();await page.locator('#inventoryAdd').click();await editor.getByLabel('Name',{exact:true}).fill('Neue Fotos');await editor.getByLabel('Ursprüngliches Quellgerät',{exact:true}).selectOption('nas');await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();
 await expect(page.locator('#strategyInventory')).toContainText('Neue Fotos');
 await page.locator('#inventoryPlanAdd').click();await expect(editor.getByLabel('Neue Fotos',{exact:true})).toBeVisible();await editor.getByRole('button',{name:'Schließen',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="datasets"]').click();await expect(page.locator('#strategyInventory')).toContainText('Neue Fotos');
 await page.screenshot({path:testInfo.outputPath('planning-categories.png'),fullPage:true});
 expect(errors).toEqual([]);await expect(page.locator('#strategyFeedback')).not.toContainText('includes');
});

test('Standort mit Geräten und Zielen kann ausdrücklich gelöst und entfernt werden; verwendete Speicherziele nennen ihre Pläne',async({page})=>{
 await login(page,{sourceDetails:false});await importPlanner(page);await page.locator('#plannerConfirm').check();await page.locator('#plannerApply').click();await expect(page.locator('#strategyFeedback')).toContainText('Planner importiert');
 const before=(await(await page.request.get('/api/status')).json()).config;
 await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="locations"]').click();
 await page.locator('#strategyInventory tbody tr').filter({hasText:'Serverraum'}).getByRole('button',{name:'Entfernen',exact:true}).click();const editor=page.locator('#strategyEditor');
 await expect(editor).toContainText('Gerät · Test-NAS');await expect(editor).toContainText('Speicherziel · Plan-PBS');
 await editor.getByRole('button',{name:'Zuordnungen lösen und Standort entfernen',exact:true}).click();await expect(editor).toBeHidden();
 await page.reload();let saved=(await(await page.request.get('/api/strategy')).json()).document;expect(saved.data.locations.map(item=>item.id)).toEqual(['home']);expect(saved.data.sources[0].location_id).toBeNull();expect(saved.data.targets.find(item=>item.id==='pbs').location_id).toBeNull();expect(saved.data.plans).toHaveLength(2);expect(saved.data.targets).toHaveLength(2);
 await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="targets"]').click();await page.locator('#strategyInventory tbody tr').filter({hasText:'Plan-PBS'}).getByRole('button',{name:'Entfernen',exact:true}).click();
 await expect(editor).toContainText('Backup-Plan · Dokumente auf PBS');await expect(editor).toContainText('Backup-Plan · Dokumente in die Cloud');await expect(editor.getByRole('button',{name:'Entfernen bestätigen',exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'Zuordnung bearbeiten',exact:true}).first().click();await expect(editor.getByLabel('Name',{exact:true})).toHaveValue('Dokumente auf PBS');
 expect((await(await page.request.get('/api/status')).json()).config).toEqual(before);
});
