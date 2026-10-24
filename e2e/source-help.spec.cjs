const {test,expect,login}=require('./fixtures.cjs');
test('Quellenhilfe funktioniert per Klick und Tastatur ohne Formulareingaben zu verändern',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});await page.locator('#manageSources').click();
 const form=page.locator('#sourceForm');await form.getByLabel('Name',{exact:true}).fill('Daten');
 const help=form.getByRole('button',{name:'Hilfe: Pfad im LXC',exact:true});await help.click();
 await expect(page.locator('#source-help-path')).toBeVisible();await expect(page.locator('#source-help-path')).toContainText('/mnt/Daten/Daten');
 await help.press('Escape');await expect(page.locator('#source-help-path')).toBeHidden();
 await form.getByRole('button',{name:'Hilfe: Backup-ID',exact:true}).focus();await expect(page.locator('#source-help-id')).toBeVisible();
 await form.getByLabel('Name',{exact:true}).focus();await expect(page.locator('#source-help-id')).toBeHidden();await expect(form.getByLabel('Name',{exact:true})).toHaveValue('Daten');
 await page.setViewportSize({width:390,height:844});await help.click();await expect(page.locator('#source-help-path')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('source-help-mobile.png'),fullPage:true});
});
