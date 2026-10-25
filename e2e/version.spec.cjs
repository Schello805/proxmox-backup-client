'use strict';
const {test,expect,login}=require('./fixtures.cjs');
for (const [status,label] of [['available','Update verfügbar'],['current','Aktuell'],['error','Prüfung fehlgeschlagen']]) {
 test(`Versionsnummer zeigt automatisch ${label}`,async({page})=>{
  let checks=0;
  await page.route('**/api/updates/check',async route=>{checks++;await route.fulfill({json:{status,message:label,checkedAt:new Date().toISOString(),latest:null}});});
  await login(page,{sourceDetails:false});
  await expect(page.locator('#versionUpdate')).toHaveText(label);
  await page.locator('#refresh').click();await expect(page.locator('#versionUpdate')).toHaveText(label);expect(checks).toBe(1);
  await page.locator('#versionUpdate').click();if(status==='available'){await expect(page.locator('#footerUpdatePanel')).toBeVisible();await expect(page.locator('#overview')).toBeVisible();}else{await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('#systemMaintenance')).toHaveAttribute('open','');}
 });
}

test('Footer startet das Update nach Bestätigung direkt auf der Übersicht und sperrt weitere Starts',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});await expect(page.locator('#footerUpdate')).toBeVisible();await page.locator('#footerUpdate').click();await expect(page.locator('#overview')).toBeVisible();await expect(page.locator('#footerInstallUpdate')).toBeEnabled();await expect(page.locator('#footerInstallUpdate')).toBeInViewport({ratio:1});await page.screenshot({path:testInfo.outputPath('footer-update-confirm.png')});
 await page.locator('#footerInstallUpdate').click();await expect(page.locator('#footerUpdateMessage')).toContainText('vorbereitet');await expect(page.locator('#footerInstallUpdate')).toBeDisabled();
 const duplicate=await page.request.post('/api/updates/install',{headers:{'X-Requested-With':'qnap-dashboard'},data:{confirm:true}});expect(duplicate.status()).toBe(409);
 const backup=await page.request.post('/api/backup/software',{headers:{'X-Requested-With':'qnap-dashboard'},data:{}});expect(backup.status()).toBe(409);
 await page.setViewportSize({width:390,height:844});await expect(page.locator('#footerUpdatePanel')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Footer nennt fehlende Aktivierung und verweigertes Update ohne Seitenwechsel',async({page})=>{
 let supported=false;await page.route('**/api/updates/install',async route=>{if(route.request().method()==='POST')await route.fulfill({status:409,json:{error:'Ein Backup läuft oder wartet.'}});else await route.fulfill({json:{phase:'idle',supported,message:'Bereit'}});});
 await login(page,{sourceDetails:false});await page.locator('#footerUpdate').click();await expect(page.locator('#footerUpdateMessage')).toContainText('enable-web-updates.sh');await expect(page.locator('#footerInstallUpdate')).toBeDisabled();
 supported=true;await page.locator('#footerCancelUpdate').click();await page.locator('#footerUpdate').click();await page.locator('#footerInstallUpdate').click();await expect(page.locator('#footerUpdateMessage')).toContainText('Ein Backup läuft oder wartet.');await expect(page.locator('#footerInstallUpdate')).toBeEnabled();await expect(page.locator('#overview')).toBeVisible();
});
test('Footer wartet bei Dienstneustart und lädt nach erfolgreichem Update genau einmal neu',async({page})=>{
 let started=false,polls=0;await page.route('**/api/updates/install',async route=>{
  if(route.request().method()==='POST'){started=true;await route.fulfill({status:202,json:{phase:'queued',supported:true,message:'Update wird vorbereitet …'}});}
  else if(started&&polls++===0)await route.abort('connectionreset');
  else await route.fulfill({json:{phase:started?'succeeded':'idle',supported:true,message:started?'Update abgeschlossen.':'Bereit'}});
 });
 await login(page,{sourceDetails:false});await page.locator('#footerUpdate').click();await page.locator('#footerInstallUpdate').click();await expect(page.locator('#footerUpdateMessage')).toContainText('Warte auf die Verbindung');
 await page.waitForEvent('load');await expect(page.locator('#overview')).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('backup-control-update-pending'))).toBeNull();
});
test('Fehlgeschlagener Helfer bleibt im Footer sichtbar und wird nicht als Erfolg gewertet',async({page})=>{
 let started=false;await page.route('**/api/updates/install',async route=>{if(route.request().method()==='POST'){started=true;await route.fulfill({status:202,json:{phase:'queued',supported:true,message:'Vorbereitung'}});}else await route.fulfill({json:{phase:started?'failed':'idle',supported:true,message:started?'Update fehlgeschlagen. Systemdienst prüfen.':'Bereit'}});});
 await login(page,{sourceDetails:false});await page.locator('#footerUpdate').click();await page.locator('#footerInstallUpdate').click();await expect(page.locator('#footerUpdateMessage')).toContainText('Update fehlgeschlagen');expect(await page.evaluate(()=>sessionStorage.getItem('backup-control-update-pending'))).toBeNull();await expect(page.locator('#overview')).toBeVisible();
});
