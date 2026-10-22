'use strict';
const { test, expect, login } = require('./fixtures.cjs');

test('Backup-Ziele, Allgemeines und Quellenpläne bleiben bei Änderungen voneinander getrennt', async ({ page }) => {
  await login(page); await page.getByRole('link', { name: /Ziele$/ }).click(); if ((await page.locator('#pbsSettings').getAttribute('open')) === null) await page.locator('#pbsSettings>summary').click();
  await expect(page.locator('#configForm')).toBeVisible(); await expect(page.locator('#targets').getByRole('combobox', { name: 'Zeitzone', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'PBS-Adresse', exact: true }).fill('pbs-neu.local');
  await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click();
  await expect(page.locator('#settings').getByRole('textbox', { name: 'PBS-Adresse', exact: true })).toHaveCount(0);
  await expect(page.locator('#settings').getByRole('combobox', { name: 'Frequenz', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Zeitzone', exact: true }).selectOption('UTC'); await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click(); await expect(page.locator('#preferencesResult')).toContainText('gespeichert');
  await page.getByRole('link', { name: /Aufträge$/ }).click(); await page.locator('tr[data-folder="software"]').getByRole('button', { name: 'Zeitplan Software bearbeiten' }).click();
  const detail=page.locator('#sourceDetail'); await detail.getByRole('combobox',{name:'Frequenz',exact:true}).selectOption('weekdays'); await detail.getByLabel('Uhrzeit',{exact:true}).fill('03:45'); await detail.getByRole('button',{name:'Quelle speichern',exact:true}).click(); await expect(detail.locator('#sourceResult')).toContainText('gespeichert');
  await page.getByRole('link',{name:/Ziele$/}).click(); if ((await page.locator('#pbsSettings').getAttribute('open')) === null) await page.locator('#pbsSettings>summary').click(); await expect(page.getByRole('textbox',{name:'PBS-Adresse',exact:true})).toHaveValue('pbs-neu.local');
  await page.getByRole('button',{name:'Backup-Ziele speichern',exact:true}).click(); await expect(page.locator('#settingsResult')).toContainText('Gespeichert');
  const config=(await (await page.request.get('/api/status')).json()).config; expect(config.timezone).toBe('UTC'); expect(config.schedules.software).toEqual({days:[1,2,3,4,5],time:'03:45'}); expect(config.repository).toBe('test@pbs@pbs-neu.local:test-store');
});

test('Falsche SMB-Zuordnung nennt die Freigabe und bietet eine konkrete Prüfung ohne automatische Bestätigung', async ({ page, app },testInfo) => {
  await login(page); await app.setMount('/mnt/Daten/Daten',{source:'//test-nas/software'}); await page.getByRole('button',{name:'↻ Aktualisieren',exact:true}).click();
  const row=page.locator('tr[data-folder="daten"]'); await expect(row.locator('.problem-message')).toHaveText('Daten zeigt auf „software“ statt „daten“.');
  await row.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click(); await expect(page).toHaveURL(/#jobs\/daten\/edit$/);
  await expect(page.locator('#sourceProblem')).toContainText('Erkannt: //test-nas/software'); await expect(page.locator('#sourceProblem')).toContainText('Erwartet: //test-nas/daten');
  const config=(await (await page.request.get('/api/status')).json()).config; expect(config.sources.find(source=>source.id==='daten').expectedSource).toBe('//test-nas/daten');
  await page.screenshot({path:testInfo.outputPath('mount-problem.png')});
  await page.locator('#closeDetail').click(); await app.setMount('/mnt/Daten/Daten',{source:'//test-nas/daten'}); await page.getByRole('button',{name:'↻ Aktualisieren',exact:true}).click(); await expect(row.getByRole('button',{name:'Zuordnung prüfen',exact:true})).toHaveCount(0);
  await page.route('**/api/status',async route=>{const response=await route.fetch();const data=await response.json();data.connections.primary={ok:false,message:'PBS nicht erreichbar'};await route.fulfill({response,json:data});});
  await page.getByRole('button',{name:'↻ Aktualisieren',exact:true}).click(); await row.getByRole('button',{name:'Backup-Ziel prüfen',exact:true}).click(); await expect(page).toHaveURL(/#targets$/); await expect(page.locator('#configForm')).toBeVisible();
});

test('Fehlgeschlagene Sicherung führt direkt zum Protokoll und unterbrochene Läufe bleiben unterscheidbar',async({page,app})=>{
  await login(page);const row=page.locator('tr[data-folder="software"]');await row.getByRole('button',{name:'Starten',exact:true}).click();await expect(row.locator('.job-state')).toContainText('Läuft');app.finish(1);await expect(row.locator('.problem-message')).toHaveText('Die letzte Sicherung ist fehlgeschlagen.');await row.getByRole('button',{name:'Protokoll prüfen',exact:true}).click();await expect(page.locator('#logText')).toContainText('Exit-Code 1');
});

test('Gantt zeigt gemessene Dauer, unbekannte Dauer, Tageszoom und direkte Zeitplanbearbeitung',async({page,app},testInfo)=>{
  await login(page);
  for(const [id,seconds] of [['software',7200],['filme',10800]]) {const row=page.locator(`tr[data-folder="${id}"]`);await row.getByRole('button',{name:'Starten',exact:true}).click();await expect(row.locator('.job-state')).toContainText('Läuft');app.finish(0,seconds);await expect(row.locator('.job-state')).toContainText('Erfolgreich');}
  const current=(await (await page.request.get('/api/status')).json()).config;
  const response=await page.request.post('/api/config',{headers:{'X-Requested-With':'qnap-dashboard'},data:{...current,schedules:{...current.schedules,software:{days:[1,2,3,4,5,6,7],time:'02:00'},filme:{days:[1,2,3,4,5,6,7],time:'02:30'},serien:{days:[1,2,3,4,5,6,7],time:'04:00'}}}});expect(response.ok()).toBe(true);await page.reload();
  const chart=page.locator('#backupTimeline');await expect(chart.locator('[data-timeline-source="software"]')).toContainText('Zuletzt: 2 h 0 min');await expect(chart.locator('[data-timeline-source="filme"]')).toContainText('Zuletzt: 3 h 0 min');await expect(chart.locator('[data-timeline-source="serien"]')).toContainText('Noch keine gemessene Dauer');
  await expect(chart.locator('[data-timeline-source="serien"] .gantt-bar.unknown')).toHaveCount(7);await expect(page.locator('#timelineSummary')).toContainText('Überschneidungen');
  const softwareHeader = await chart.locator('[data-timeline-source="software"] .gantt-source').boundingBox(); const filmeHeader = await chart.locator('[data-timeline-source="filme"] .gantt-source').boundingBox(); expect(filmeHeader.x).toBeGreaterThan(softwareHeader.x); expect(filmeHeader.y).toBe(softwareHeader.y);
  await page.screenshot({path:testInfo.outputPath('gantt-week.png'),fullPage:true});
  const data=(await (await page.request.get('/api/status')).json()).timeline;await page.getByRole('combobox',{name:'Zeitraum im Gantt-Diagramm',exact:true}).selectOption(data.days[0].day);
  const bar=chart.locator('[data-timeline-source="software"] .gantt-bar').first();await expect(bar).toHaveAttribute('aria-label',/Dauer zuletzt: 2 h 0 min/);
  const height=await bar.evaluate(element=>parseFloat(element.style.height));expect(height).toBeCloseTo(7200000/(data.days[0].end-data.days[0].start)*100,3);
  await page.screenshot({path:testInfo.outputPath('gantt-day.png'),fullPage:true});
  await bar.click();await expect(page).toHaveURL(/#jobs\/software\/edit$/);await expect(page.locator('#sourceDetail').getByLabel('Uhrzeit',{exact:true})).toHaveValue('02:00');
  await page.locator('#closeDetail').click();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(chart).toBeVisible();expect(await chart.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
});
