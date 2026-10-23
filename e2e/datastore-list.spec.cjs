'use strict';
const {test,expect,login}=require('./fixtures.cjs');
test('Dynamische Liste zeigt alle vier Datastores mit einheitlichen Aktionen und öffnet den gewählten Bestand',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});const headers={'X-Requested-With':'qnap-dashboard'};
 for(const datastore of ['pbs2','pbs3','pbs4'])expect((await page.request.post('/api/targets/setup',{headers,data:{datastore}})).ok()).toBe(true);
 await page.reload();await page.getByRole('link',{name:/Ziele$/}).click();await page.locator('#pbsSettings>summary').click();
 const list=page.locator('#additionalTargets');await expect(list.locator('tbody tr')).toHaveCount(4);
 for(const id of ['primary','secondary','extra1','extra2']){const row=list.locator(`[data-datastore="${id}"]`);for(const name of ['Änderung speichern','Prüfen','Entfernen'])await expect(row.getByRole('button',{name,exact:true})).toBeVisible();await expect(row.getByRole('link',{name:'Bestand',exact:true})).toBeVisible();}
 await expect(page.getByRole('textbox',{name:'Datastore 1',exact:true})).toHaveCount(0);
 await list.locator('[data-datastore="extra1"]').getByRole('button',{name:'Prüfen',exact:true}).click();await expect(list.locator('[data-datastore="extra1"] .badge')).toHaveText('Erreichbar');
 await list.screenshot({path:testInfo.outputPath('four-datastores.png')});
 await list.locator('[data-datastore="extra1"]').getByRole('link',{name:'Bestand',exact:true}).click();await expect(page.locator('#pbsTarget')).toHaveValue('extra1');
 await expect(page).toHaveURL(/#pbsDialog\/extra1$/);await page.evaluate(()=>{window.dispatchEvent(new PopStateEvent('popstate'));window.dispatchEvent(new HashChangeEvent('hashchange'));});await expect(page.locator('#pbsTarget')).toHaveValue('extra1');await page.reload();await expect(page.locator('#pbsTarget')).toHaveValue('extra1');
 await page.getByRole('link',{name:/Ziele$/}).click();await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
