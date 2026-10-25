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
 async function add(kind,name,fill){await page.locator(`[data-inventory-kind="${kind}"]`).click();await page.locator('#inventoryAdd').click();await editor.getByLabel(kind==='targets'?'Name des Speicherziels':'Name',{exact:true}).fill(name);if(fill)await fill();await editor.getByRole('button',{name:kind==='targets'?'Speicherziel speichern':'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();}
 await add('locations','Teststandort');
 await add('sources','Testgerät',async()=>{await editor.getByLabel('Standort',{exact:true}).selectOption({label:'Teststandort'});});
 await add('targets','Testziel',async()=>{await editor.getByLabel('Speichertyp',{exact:true}).selectOption('cloud');await editor.getByText('Weitere Angaben · optional',{exact:true}).click();await editor.getByLabel('Unveränderliche Sicherung möglich',{exact:true}).check();});
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
  await expect(editor.getByLabel(kind==='targets'?'Name des Speicherziels':'Name',{exact:true})).toBeVisible();await editor.getByRole('button',{name:'Schließen',exact:true}).click();
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

test('Daten bearbeiten zeigt alle Planziele; Zielwechsel bleibt erhalten und gemeinsame Pläne brauchen Bestätigung',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});const before=(await(await page.request.get('/api/status')).json()).config,current=await(await page.request.get('/api/strategy')).json(),document=fixture();
 document.data.targets.push({id:'new-target',name:'Neues Speicherziel'});document.data.datasets.push({id:'photos',name:'Weitere Fotos',source_id:'nas'});document.data.plans[0].dataset_ids.push('photos');
 const response=await page.request.post('/api/strategy/import',{headers,data:{document,mapping:{datasets:{},targets:{}},revision:current.revision}});expect(response.ok()).toBe(true);
 await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('link',{name:/Backup-Planung$/}).click();await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="datasets"]').click();
 const row=page.locator('#strategyInventory tbody tr').filter({hasText:'Dokumente'}),editor=page.locator('#strategyEditor');await expect(row).toContainText('Plan-PBS');await expect(row).toContainText('Plan-Cloud');await row.getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await expect(editor.getByLabel('Ziel für Dokumente auf PBS',{exact:true})).toHaveValue('pbs');await expect(editor.getByLabel('Ziel für Dokumente in die Cloud',{exact:true})).toHaveValue('cloud');
 await editor.getByLabel('Ziel für Dokumente in die Cloud',{exact:true}).selectOption('new-target');await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();
 await page.reload();await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="datasets"]').click();await row.getByRole('button',{name:'Bearbeiten',exact:true}).click();await expect(editor.getByLabel('Ziel für Dokumente in die Cloud',{exact:true})).toHaveValue('new-target');
 await editor.getByLabel('Ziel für Dokumente auf PBS',{exact:true}).selectOption('new-target');await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toContainText('Zieländerung für den gesamten Plan „Dokumente auf PBS“ bestätigen.');
 let saved=(await(await page.request.get('/api/strategy')).json()).document;expect(saved.data.plans.find(plan=>plan.id==='daily').target_id).toBe('pbs');
 await expect(editor).toContainText('Dieser Plan sichert auch: Weitere Fotos');await editor.getByLabel('Zieländerung für den gesamten Plan bestätigen',{exact:true}).check();await page.screenshot({path:testInfo.outputPath('dataset-target-editor.png'),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await editor.getByRole('button',{name:'Eintrag speichern',exact:true}).click();await expect(editor).toBeHidden();
 saved=(await(await page.request.get('/api/strategy')).json()).document;expect(saved.data.plans.find(plan=>plan.id==='daily')).toMatchObject({target_id:'new-target',dataset_ids:['docs','photos'],schedule_type:'daily',start_time:'02:00',duration_minutes:90});expect((await(await page.request.get('/api/status')).json()).config).toEqual(before);
});

test('Speicherziel anlegen und bearbeiten erzeugt ausschließlich ein Ziel und keinen Plan oder Auftrag',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});const before=(await(await page.request.get('/api/status')).json()).config,current=await(await page.request.get('/api/strategy')).json();
 const document={format:1,data:{sources:[{id:'pbs-device',name:'Proxmox Backup Server',device_type:'server'}]}};
 const res=await page.request.post('/api/strategy/import',{headers,data:{document,mapping:{datasets:{},targets:{}},revision:current.revision}});expect(res.ok()).toBe(true);
 await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('link',{name:/Backup-Planung$/}).click();await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="targets"]').click();await expect(page.locator('#inventoryPlanAdd')).toBeHidden();await page.locator('#inventoryAdd').click();
 const editor=page.locator('#strategyEditor');await expect(editor.getByRole('heading',{name:'Speicherziel anlegen',exact:true})).toBeVisible();await expect(editor.locator('[name="source_id"], [name="schedule_type"], [name="dataset_ids"]')).toHaveCount(0);await expect(editor.getByLabel('Standort',{exact:true})).toBeHidden();
 await editor.getByLabel('Name des Speicherziels',{exact:true}).fill('pbs2');await editor.getByLabel('Gerät des Ziels',{exact:true}).selectOption('pbs-device');await editor.getByLabel('Speichertyp',{exact:true}).selectOption('pbs');await page.screenshot({path:testInfo.outputPath('target-only-editor.png'),fullPage:true});await editor.getByRole('button',{name:'Speicherziel speichern',exact:true}).click();await expect(editor).toBeHidden();await expect(page.locator('#strategyFeedback')).toContainText('kein Backup-Plan oder Auftrag angelegt');
 let saved=(await(await page.request.get('/api/strategy')).json()).document;expect(saved.data.targets).toHaveLength(1);expect(saved.data.targets[0]).toMatchObject({name:'pbs2',device_id:'pbs-device',storage_type:'pbs'});expect(saved.data.plans).toHaveLength(0);expect(saved.data.datasets).toHaveLength(0);expect(saved.data.sources).toHaveLength(1);expect((await(await page.request.get('/api/status')).json()).config).toEqual(before);
 await page.reload();await page.getByRole('button',{name:'Geräte, Daten & Ziele',exact:true}).click();await page.locator('[data-inventory-kind="targets"]').click();await page.locator('#strategyInventory tbody tr').getByRole('button',{name:'Bearbeiten',exact:true}).click();await expect(editor.getByRole('heading',{name:'Speicherziel bearbeiten',exact:true})).toBeVisible();await editor.getByText('Weitere Angaben · optional',{exact:true}).click();await editor.getByLabel('Verschlüsselung vorgesehen',{exact:true}).check();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await editor.getByRole('button',{name:'Speicherziel speichern',exact:true}).click();await expect(editor).toBeHidden();
 saved=(await(await page.request.get('/api/strategy')).json()).document;expect(saved.data.targets[0].encrypted_default).toBe(1);expect(saved.data.plans).toHaveLength(0);expect((await(await page.request.get('/api/status')).json()).config).toEqual(before);
});
