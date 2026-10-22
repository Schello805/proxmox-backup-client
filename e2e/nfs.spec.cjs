'use strict';
const {test,expect,login}=require('./fixtures.cjs');
test('Wechsel von SMB zu NFS verlangt Bestätigung im Frontend und erlaubt anschließend Backup',async({page,app})=>{
 await login(page,{sourceDetails:false});
 await app.setMount('/mnt/Daten/Daten',{type:'nfs4',source:'192.168.1.21:/Daten'});
 await page.locator('#refresh').click();await page.getByRole('link',{name:/Quellen$/}).click();
 const row=page.locator('#sourceList tr').filter({has:page.getByText('Daten',{exact:true})});await row.getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await expect(page.locator('#sourceProblem')).toContainText('192.168.1.21:/Daten');
 await page.locator('#probeSource').click();await expect(page.locator('#sourceForm').getByLabel('Erwartete Netzwerkfreigabe',{exact:true})).toHaveValue('192.168.1.21:/Daten');
 await page.locator('#sourceForm').getByRole('button',{name:'Quelle speichern',exact:true}).click();
 await expect(page.locator('#sourceResult')).toContainText('gespeichert');
 await page.locator('#refresh').click();await page.getByRole('link',{name:/Aufträge$/}).click();
 await page.locator('[data-folder="daten"]').getByRole('button',{name:'Starten',exact:true}).click();
 await expect(page.locator('[data-folder="daten"] .job-state')).toContainText('Läuft');
});
