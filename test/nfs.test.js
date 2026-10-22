'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mountIssue,mountFor}=require('../lib/mounts');
const {validateSources}=require('../lib/sources');
const {createDiscovery}=require('../lib/discovery');
test('NFS und NFS4 erlauben bestätigte Exporte, sperren alte Mount-Zuordnung und lokale Pfade',()=>{
 for(const type of ['nfs','nfs4']){
  const mount=mountFor('/mnt/Daten/Daten',`10 1 0:12 / /mnt/Daten/Daten rw - ${type} 192.168.1.21:/Daten rw`);
  assert.equal(mountIssue(mount,'192.168.1.21:/Daten'),'');
  assert.match(mountIssue(mount,'//192.168.1.21/Daten'),/stimmt nicht/);
  assert.match(mountIssue(mount,'192.168.1.21:/Software'),/stimmt nicht/);
 }
 assert.match(mountIssue({type:'ext4',source:'/dev/sda'},''),/gesperrt/);
});
test('Quellen validieren SMB sowie NFS mit Hostnamen und IPv6',()=>{
 const source={id:'daten',name:'Daten',path:'/mnt/Daten/Daten'};
 for(const expectedSource of ['//nas/Daten','192.168.1.21:/Daten','nas:/export/Daten','[fe80::1]:/Daten'])assert.equal(validateSources([{...source,expectedSource}])[0].expectedSource,expectedSource);
 for(const expectedSource of ['nas:Daten','/Daten','nas:/Daten\n','nas:/Daten\0'])assert.throws(()=>validateSources([{...source,expectedSource}]));
});
test('Mount-Erkennung findet neue NFS-Freigaben im LXC',async()=>{
 const service=createDiscovery({getConfig:()=>({sources:[]}),readMountinfo:async()=> '10 1 0:12 / /mnt/Daten/Daten rw - nfs4 192.168.1.21:/Daten rw'});
 const result=await service.refresh();assert.equal(result.candidates[0].expectedSource,'192.168.1.21:/Daten');
});
