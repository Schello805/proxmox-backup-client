'use strict';
const {test,expect,login}=require('./fixtures.cjs');
for (const [status,label] of [['available','Update verfügbar'],['current','Aktuell'],['error','Prüfung fehlgeschlagen']]) {
 test(`Versionsnummer zeigt automatisch ${label}`,async({page})=>{
  let checks=0;
  await page.route('**/api/updates/check',async route=>{checks++;await route.fulfill({json:{status,message:label,checkedAt:new Date().toISOString(),latest:null}});});
  await login(page,{sourceDetails:false});
  await expect(page.locator('#versionUpdate')).toHaveText(label);
  await page.locator('#refresh').click();await expect(page.locator('#versionUpdate')).toHaveText(label);expect(checks).toBe(1);
  await page.locator('#versionUpdate').click();await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('#systemMaintenance')).toHaveAttribute('open','');
 });
}
