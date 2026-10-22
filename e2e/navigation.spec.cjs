'use strict';
const {test,expect,login}=require('./fixtures.cjs');
test('Eine Hauptnavigation bündelt Quellen und System; PBS-Bestand liegt beim Ziel',async({page},testInfo)=>{
  await login(page,{sourceDetails:false});const nav=page.getByRole('navigation',{name:'Hauptnavigation',exact:true});await expect(nav).toHaveCount(1);await expect(nav.getByRole('link')).toHaveCount(6);await expect(page.locator('#openSystem')).toHaveCount(0);await expect(page.locator('main>header nav')).toHaveCount(0);await expect(page.locator('main>header')).toContainText('Aktualisiert');await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);await page.screenshot({path:testInfo.outputPath('navigation-desktop.png')});
  await nav.getByRole('link',{name:'Quellen',exact:true}).click();await expect(page.locator('#sourcesDialog')).toBeVisible();await expect(page.locator('#manageSources')).toHaveAttribute('aria-current','page');
  await nav.getByRole('link',{name:/Backup-Ziele$/}).click();await page.locator('#pbsSettings>summary').click();await page.getByRole('link',{name:'PBS-Bestand',exact:true}).click();await expect(page.locator('#pbsDialog')).toBeVisible();await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-page','targets');await page.goBack();await expect(page.locator('#targets')).toBeVisible();
  await nav.getByRole('link',{name:/Einstellungen/}).click();await page.locator('#systemMaintenance>summary').click();await expect(page.locator('#systemMaintenance')).toBeVisible();await expect(nav.getByRole('link',{name:/Einstellungen/})).toHaveAttribute('aria-current','page');await expect(page.locator('#installedVersion')).toContainText('Installiert: v');await page.reload();await expect(nav.getByRole('link',{name:/Einstellungen/})).toHaveAttribute('aria-current','page');
  await nav.getByRole('link',{name:/Übersicht/}).click();await page.locator('#sourceOverviewDetails>summary').click();await page.locator('tr[data-folder="software"]').getByRole('button',{name:'Zeitplan Software bearbeiten',exact:true}).click();await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-page','overview');
});
test('Mobil bleibt dieselbe Navigation vollständig sichtbar und ohne horizontales Scrollen',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await login(page,{sourceDetails:false});const nav=page.getByRole('navigation',{name:'Hauptnavigation',exact:true});for(const link of await nav.getByRole('link').all())await expect(link).toBeInViewport();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('navigation-mobile.png')});
  await nav.getByRole('link',{name:/Einstellungen/}).click();await page.locator('#systemMaintenance>summary').click();await expect(page.locator('#systemMaintenance')).toBeVisible();await expect(page.locator('#settings #systemInfo')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('settings-system-mobile.png')});await page.locator('#manageSources').click();await expect(page.locator('#sourcesDialog')).toBeVisible();await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
});

test('Bisheriger System-Link öffnet den gemeinsamen Einstellungsbereich',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});await page.evaluate(()=>location.hash='systemDialog');
 await expect(page).toHaveURL(/#settings$/);await expect(page.locator('#settings')).toBeVisible();
 await expect(page.locator('#systemMaintenance')).toHaveAttribute('open','');
 await expect(page.locator('#settings #systemInfo')).toBeVisible();await expect(page.locator('#overview #systemInfo')).toHaveCount(0);
 await expect(page.locator('#installedVersion')).toContainText('Installiert: v');
 await page.locator('#systemMaintenance').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('settings-system.png')});
});
