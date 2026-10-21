'use strict';
const {test,expect,login}=require('./fixtures.cjs');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Quelle mit Drive-Auswahl abmelden, letzte Quelle entfernen und neu hinzufügen',async({page})=>{
 await login(page,{sourceDetails:false});
 let response=await page.request.post('/api/gdrive',{headers:{'X-Requested-With':'qnap-dashboard'},data:{remote:'gdrive',folder:'QNAP-Backup',sources:['daten'],schedule:''}});expect(response.ok()).toBe(true);
 await page.reload();await page.getByRole('link',{name:'Quellen',exact:true}).click();
 await page.locator('#sourceList tr[data-source-id="daten"]').getByRole('button',{name:'Abmelden',exact:true}).click();await expect(page.locator('#sourceList tr')).toHaveCount(5);
 response=await page.request.get('/api/status');expect((await response.json()).config.gdrive.sources).toEqual([]);
 for(const id of ['software','filme','serien','hoerspiele','musik']){await page.locator(`#sourceList tr[data-source-id="${id}"]`).getByRole('button',{name:'Abmelden',exact:true}).click();await expect(page.locator(`#sourceList tr[data-source-id="${id}"]`)).toHaveCount(0);}
 await expect(page.locator('#sourceListCount')).toHaveText('0 von 0 Quellen');
 const form=page.locator('#sourceForm');await form.getByLabel('Name',{exact:true}).fill('Daten');await form.getByLabel('Backup-ID',{exact:true}).fill('daten');await form.getByLabel('Pfad im LXC',{exact:true}).fill('/mnt/Daten/Daten');await form.getByLabel('Erwartete SMB-Freigabe',{exact:true}).fill('//test-nas/daten');await form.getByRole('button',{name:'Quelle speichern',exact:true}).click();await expect(page.locator('#sourceList tr')).toHaveCount(1);
});
test('Ziel entfernen verlangt Bestätigung und entfernt nur App-Konfiguration; Drive deaktivieren',async({page})=>{
 await login(page,{sourceDetails:false});await page.getByRole('link',{name:/Backup-Ziele$/}).click();await page.locator('#pbsSettings>summary').click();await page.getByText('PBS-Ziel aus der App entfernen',{exact:true}).click();await page.locator('#removeTarget').click();await expect(page.locator('#removeTargetResult')).toContainText('bestätigen');await page.locator('#confirmTargetRemoval').check();await page.locator('#removeTarget').click();await expect(page.locator('#removeTargetResult')).toContainText('Ziel aus der App entfernt');
 const response=await page.request.get('/api/status'),data=await response.json();expect(data.config.repository).toBe('');expect(data.config.hasPassword).toBe(false);expect(data.config.sources).toHaveLength(6);
 await page.locator('#driveSettings>summary').click();await page.locator('#drivePanel').getByLabel('Daten',{exact:true}).check();await page.getByRole('button',{name:'Google Drive speichern',exact:true}).click();await expect(page.locator('#driveResult')).toContainText('gespeichert');await page.locator('#driveDisable').click();await expect(page.locator('#driveResult')).toContainText('deaktiviert');await expect(page.locator('#drivePanel').getByLabel('Daten',{exact:true})).not.toBeChecked();
});
test('Mount-Verwaltung erzeugt begrenzte und syntaktisch gültige Host-Befehle',async({page},testInfo)=>{
 await login(page,{sourceDetails:false});await page.getByRole('link',{name:'Quellen',exact:true}).click();await page.getByRole('link',{name:'Mounts verwalten',exact:true}).click();await page.locator('#mountSource').selectOption('daten');await expect(page.locator('#mountPath')).toHaveValue('/mnt/Daten/Daten');
 for(const action of ['inspect','replace','remove']){await page.locator('#mountAction').selectOption(action);const command=await page.locator('#mountCommand').textContent();expect(spawnSync('bash',['-n'],{input:command,encoding:'utf8'}).status).toBe(0);if(action!=='inspect')expect(command).toContain('status: stopped');if(action==='remove')expect(command).toContain('pct set "$ct" --delete "$slot"');}
 await page.locator('#mountCT').fill('119; rm');await expect(page.locator('#copyMountCommand')).toBeDisabled();await expect(page.locator('#mountCommand')).toHaveText('');await page.locator('#mountCT').fill('119');await page.screenshot({path:testInfo.outputPath('mount-management.png')});
});

test('Mount-Befehle verwenden den vorhandenen Slot und verweigern falsche Freigaben oder laufende LXC',async({page})=>{
 await login(page,{sourceDetails:false});await page.getByRole('link',{name:'Quellen',exact:true}).click();await page.getByRole('link',{name:'Mounts verwalten',exact:true}).click();await page.locator('#mountSource').selectOption('daten');await page.locator('#mountAction').selectOption('replace');
 const command=await page.locator('#mountCommand').textContent(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mount-command-')),log=path.join(dir,'calls');
 try{
  fs.writeFileSync(path.join(dir,'pct'),`#!/bin/sh
case "$1" in
config) echo 'mp7: /mnt/old,mp=/mnt/Daten/Daten,ro=1';;
status) echo "status: \${MOCK_STATUS:-stopped}";;
set) printf '%s\\n' "$*" >> "$MOUNT_LOG";;
esac
`,{mode:0o755});
  fs.writeFileSync(path.join(dir,'findmnt'),`#!/bin/sh
case "$*" in *SOURCE*) echo "\${MOCK_SHARE:-//test-nas/daten}";; *) echo cifs;; esac
`,{mode:0o755});
  const env={...process.env,PATH:dir+path.delimiter+process.env.PATH,MOUNT_LOG:log};
  expect(spawnSync('bash',[],{input:command,env,encoding:'utf8'}).status).toBe(0);expect(fs.readFileSync(log,'utf8')).toContain('set 119 -mp7 /mnt/pve/QNAP4bay-Daten,mp=/mnt/Daten/Daten,ro=1');
  fs.writeFileSync(log,'');expect(spawnSync('bash',[],{input:command,env:{...env,MOCK_STATUS:'running'},encoding:'utf8'}).status).toBe(1);expect(fs.readFileSync(log,'utf8')).toBe('');
  expect(spawnSync('bash',[],{input:command,env:{...env,MOCK_SHARE:'//test-nas/software'},encoding:'utf8'}).status).toBe(1);expect(fs.readFileSync(log,'utf8')).toBe('');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
