'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('Formularzustand schützt Eingaben, auch Änderungen während des Speicherns', async()=>{
 const {createFormState}=await import('../public/js/forms.js');const form=new EventTarget();form.id='configForm';form.dataset={};const forms=createFormState([form]);
 assert.equal(forms.dirty(form.id),false);form.dispatchEvent(new Event('input'));const stamp=forms.capture(form.id);assert.equal(forms.dirty(form.id),true);
 forms.touch(form.id);assert.equal(forms.clean(form.id,stamp),false);assert.equal(forms.dirty(form.id),true);
 assert.equal(forms.clean(form.id,forms.capture(form.id)),true);assert.equal(forms.dirty(form.id),false);
});
test('Feldvalidierung benennt PBS-, Zeitplan- und ntfy-Fehler',async()=>{
 const {validateMainForm,validateNotifyForm}=await import('../public/js/forms.js');
 const valid={server:'192.168.1.10',authId:'backup@pbs',datastore:'pbs1',password:'',fingerprint:'',namespace:'',timezone:'Europe/Berlin',staleAfterDays:14,schedules:{software:{days:[1],time:'02:30'}}};
 assert.deepEqual(validateMainForm(valid),{});
 const errors=validateMainForm({...valid,server:'https://pbs',timezone:'Mars/Test',schedules:{software:{days:[1],time:''}}});assert.ok(errors.server);assert.ok(errors.timezone);assert.ok(errors['schedule-software']);
 assert.deepEqual(validateNotifyForm({enabled:true,server:'https://ntfy.sh',topic:'test-topic'}),{});assert.ok(validateNotifyForm({enabled:true,server:'missing',topic:''}).topic);
});
test('API liefert Server-Feldfehler weiter und behandelt abgelaufene Sitzungen',async()=>{
 const {createAPI}=await import('../public/js/api.js');let unauthorized=0;const api=createAPI(()=>unauthorized++,async()=>({ok:false,status:400,json:async()=>({error:'Zeitzone ungültig',field:'timezone'})}));
 await assert.rejects(api('/api/config',{}),error=>error.field==='timezone'&&error.status===400);
 const expired=createAPI(()=>unauthorized++,async()=>({ok:false,status:401,json:async()=>({error:'Bitte anmelden'})}));await assert.rejects(expired('/api/status'));assert.equal(unauthorized,1);
});

test('Darstellungsmodul erhält Statusbezeichnungen explizit und rendert Leerlauf',async()=>{
 const {createViews}=await import('../public/js/views.js');const children=[];const view=createViews(()=> 'UTC',{idle:'Noch kein Lauf'},{createElement:tag=>({tagName:tag})});
 view.renderJob({replaceChildren:(...elements)=>children.push(...elements)},{status:'idle'},null);assert.equal(children[0].textContent,'Noch kein Lauf');
 assert.equal(view.scheduleText({days:[1,3],time:'02:30'}),'Mo, Mi · 02:30');
});

test('Quellenformular meldet doppelte IDs und überlappende Pfade vor dem Speichern',async()=>{
 const {validateSourceForm}=await import('../public/js/forms.js');const source={id:'daten',name:'Daten',path:'/mnt/Daten/Daten',expectedSource:''};
 assert.deepEqual(validateSourceForm(source,[],null),{});const errors=validateSourceForm(source,[source],null);assert.ok(errors.id);assert.ok(errors.path);assert.deepEqual(validateSourceForm(source,[source],'daten'),{});
});

test('Quellenformular akzeptiert NFS-Exporte und lehnt unvollständige NFS-Adressen ab',async()=>{
 const {validateSourceForm}=await import('../public/js/forms.js');
 const source={id:'daten',name:'Daten',path:'/mnt/Daten/Daten',expectedSource:'192.168.1.21:/Daten'};
 assert.deepEqual(validateSourceForm(source,[],null),{});
 assert.ok(validateSourceForm({...source,expectedSource:'nas:Daten'},[],null).expectedSource);
});
