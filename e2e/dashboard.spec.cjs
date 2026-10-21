'use strict';
const {test,expect,login}=require('./fixtures.cjs');
test('Dashboard fasst Mounts und Ziele zusammen und führt in die vollständige Quellenliste',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});await expect(page.locator('#sourceOverviewDetails')).not.toHaveAttribute('open','');await expect(page.locator('#overviewPlan')).not.toHaveAttribute('open','');await expect(page.locator('#dashboardMounts button')).toHaveCount(6);await expect(page.locator('#dashboardTargets')).toContainText('Google Drive');await expect(page.locator('#dashboardTargets')).toContainText('PBS');await expect(page.locator('#dashboardMountSummary')).toHaveText('6 von 6 verfügbar');await page.screenshot({path:testInfo.outputPath('dashboard.png')});await page.locator('#dashboardTargets article').filter({hasText:'Google Drive'}).getByRole('button').click();await expect(page.locator('#drivePanel')).toBeInViewport();await page.getByRole('link',{name:/Übersicht/}).click();
 await page.locator('[data-dashboard-source="daten"]').click();await expect(page.locator('#sourcesDialog')).toBeVisible();await expect(page.locator('#sourceSearch')).toHaveValue('Daten');await expect(page.locator('#sourceList tr')).toHaveCount(1);await page.locator('#sourceSearch').fill('');await expect(page.locator('#sourceList tr')).toHaveCount(6);const region=page.getByRole('region',{name:'Alle Datenquellen',exact:true});await region.evaluate(node=>node.scrollTop=node.scrollHeight);const header=await page.locator('.sources-table th').first().boundingBox(),viewport=await region.boundingBox();expect(Math.abs(header.y-viewport.y)).toBeLessThan(3);await page.locator('#sourceSearch').fill('Software');await expect(page.locator('#sourceList tr')).toHaveCount(1);await expect(page.locator('#sourceList')).toContainText('/mnt/Daten/Software');await page.screenshot({path:testInfo.outputPath('sources.png')});
});
test('Dashboard unterscheidet eine falsche Freigabe und ungeprüfte Ziele; Quellenfilter zeigt Ausfälle',async({page,app})=>{
 await page.route('**/api/status',async route=>{const response=await route.fetch(),data=await response.json();data.connections={};data.capacities={};await route.fulfill({response,json:data});});
 await login(page,{sourceDetails:false});await expect(page.locator('#dashboardTargets')).toContainText('Ungeprüft / veraltet');await app.setMount('/mnt/Daten/Daten',{source:'//test-nas/wrong'});await page.getByRole('button',{name:'↻ Aktualisieren',exact:true}).click();await expect(page.locator('[data-dashboard-source="daten"]')).toContainText('Nicht verfügbar');await expect(page.locator('#dashboardIssues')).toContainText('Daten zeigt');await page.locator('#dashboardMoreSources').click();await page.locator('#sourceStatusFilter').selectOption('unavailable');await expect(page.locator('#sourceList tr')).toHaveCount(1);await expect(page.locator('#sourceList')).toContainText('Daten');await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Ziele gemeinsam hinzufügen und Kennzahlen zwischen Quellen und Zielen prüfen',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});
 await page.getByRole('link',{name:/Backup-Ziele$/}).click();
 await expect(page.locator('#targetMetrics')).toContainText('1 PBS-Datastores · 0 Google Drive');
 await expect(page.locator('#configureDrive')).not.toBeVisible();
 await page.locator('#addTargetMenu > summary').click();
 await expect(page.locator('.target-options a')).toHaveAttribute('href','#assistant/pbs');
 await page.screenshot({path:testInfo.outputPath('target-picker.png')});
 await page.locator('#configureDrive').click();
 await expect(page.locator('#addTargetMenu')).not.toHaveAttribute('open','');
 await expect(page.locator('#drivePanel')).toBeInViewport();
 await page.locator('#drivePanel').getByLabel('Daten',{exact:true}).check();
 await page.getByRole('button',{name:'Google Drive speichern',exact:true}).click();
 await expect(page.locator('#targetMetrics')).toContainText('1 PBS-Datastores · 1 Google Drive');
 await expect(page.locator('#driveSettings > summary')).toHaveText('Google Drive · 1 Quelle');
 await page.screenshot({path:testInfo.outputPath('targets.png')});
 await page.getByRole('link',{name:'Quellen',exact:true}).click();
 await expect(page.locator('#sourceMetrics')).toContainText('Quellen insgesamt');
 await expect(page.locator('#sourceMetrics')).toContainText('von 6 Quellen gemessen');
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
