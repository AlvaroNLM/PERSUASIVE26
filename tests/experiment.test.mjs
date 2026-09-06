import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyProfile, explainClassification} from '../js/classifier.js';
import {CASE_FEATURES, FEATURE_KEYS} from '../js/case.js';
import {assignCondition,beginSession,lockPreJudgement} from '../js/experiment.js';
import {buildSubmissionPayload,sendSubmission} from '../js/submission.js';
import {createHarness} from './helpers.mjs';
import {QUESTIONS, questionnaireMarkup, isJudgement} from '../js/questionnaire.js';
import {saveSession,loadSession,isCompleted,completeSession,checkStorage,SessionStateError} from '../js/storage.js';
test('fixed stimulus produces the intended assessment and truthful factors',()=>{
 const result=classifyProfile(CASE_FEATURES);
 assert.equal(result.classification,'ADHD_RELATED');
 assert.equal(result.attentionScore,9); assert.equal(result.socialScore,2);
 assert.equal(result.explanationFactors.length,3);
 for(const f of result.explanationFactors) assert.equal(f.contribution,CASE_FEATURES[f.feature]);
});
test('all 15,625 possible profiles follow the same score rule and explanation',()=>{
 for(let value=0;value<15625;value++){
  let n=value; const features=Object.fromEntries(FEATURE_KEYS.map(k=>{const v=n%5;n=Math.floor(n/5);return [k,v];}));
  const result=classifyProfile(features);
  assert.equal(result.classification,result.attentionScore>result.socialScore?'ADHD_RELATED':result.attentionScore<result.socialScore?'ASD_RELATED':'INCONCLUSIVE');
  for(const factor of result.explanationFactors) assert.equal(factor.value,features[factor.feature]);
 }
});
test('invalid features are rejected',()=>{
 for(const v of [-1,5,1.5,'3',null,undefined]) assert.throws(()=>classifyProfile({...CASE_FEATURES,distractibility:v}));
 assert.throws(()=>classifyProfile(null));
});
test('production ignores forced-condition URLs',()=>{
 assert.equal(assignCondition(()=>0.1,'?condition=XAI'),'NO_XAI');
 assert.equal(assignCondition(()=>0.9,'?condition=NO_XAI'),'XAI');
});
test('session, assignment and submission ID survive reload; completion retains retry payload',()=>{
 const entries=new Map(); globalThis.localStorage={setItem:(k,v)=>entries.set(k,String(v)),getItem:k=>entries.get(k)??null,removeItem:k=>entries.delete(k)};
 checkStorage(); const session=beginSession();const id=session.submission_id;
 session.step='pre';session.pre_ai_judgement=4;saveSession(session);
 globalThis.location={search:''};lockPreJudgement(session);
 assert.deepEqual(loadSession(),session); assert.equal(isCompleted(),false);
 session.post_ai_judgement=2;session.answers=Object.fromEntries(QUESTIONS.map(([k])=>[k,4]));session.step='questionnaire';
 session.final_payload=buildSubmissionPayload(session);saveSession(session);
 completeSession(session); assert.equal(isCompleted(),true);assert.equal(loadSession().submission_id,id);assert.deepEqual(loadSession().final_payload,session.final_payload);
});
test('questionnaire has 13 required numeric scales',()=>{
 assert.equal(QUESTIONS.length,13);assert.equal(new Set(QUESTIONS.map(([k])=>k)).size,13);
 const html=questionnaireMarkup({a1:7});assert.equal((html.match(/type="radio"/g)||[]).length,91);assert.equal((html.match(/ required /g)||[]).length,91);
});
test('static module imports resolve under the Pages subpath',()=>{
 for(const dir of ['js'])for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){
  const source=fs.readFileSync(`${dir}/${file}`,'utf8');
  for(const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) assert.ok(fs.existsSync(new URL(match[1],new URL(`../${dir}/${file}`,import.meta.url))));
 }
 assert.ok(fs.existsSync('.nojekyll'));
});

test('initial judgement validation and corrupt/old storage are explicit',async()=>{
 for(const value of [0,8,1.5,'4',null,undefined])assert.equal(isJudgement(value),false);
 for(let i=1;i<=7;i++)assert.equal(isJudgement(i),true);
 for(const raw of ['{broken',JSON.stringify({experiment_version:'1.0.0'}),JSON.stringify({experiment_version:'1.1.0'})]){
  localStorage.setItem('hci_experiment_v1',raw);assert.throws(loadSession,SessionStateError);
 }
 localStorage.removeItem('hci_experiment_v1');
});
test('explanation API rejects inconsistent classification',()=>{
 assert.deepEqual(explainClassification(CASE_FEATURES,classifyProfile(CASE_FEATURES)),classifyProfile(CASE_FEATURES).explanationFactors);
 assert.throws(()=>explainClassification(CASE_FEATURES,{classification:'ASD_RELATED'}));
});


function completeDraft() {
 localStorage.removeItem('hci_experiment_v1');localStorage.removeItem('experiment_completed');
 const session=beginSession();session.pre_ai_judgement=5;lockPreJudgement(session);session.post_ai_judgement=2;
 session.answers=Object.fromEntries(QUESTIONS.map(([k])=>[k,4]));session.step='questionnaire';saveSession(session);return session;
}
test('local pre and assignment are immutable without any network request',()=>{
 const session=completeDraft();const original=loadSession();
 assert.throws(()=>saveSession({...session,pre_ai_judgement:1}),/locked/);
 assert.throws(()=>saveSession({...session,condition:session.condition==='XAI'?'NO_XAI':'XAI'}),/locked/);
 assert.throws(()=>saveSession({...session,step:'pre'}),/locked/);
 assert.deepEqual(loadSession(),original);
});
test('final payload contains every sheet column except its server timestamp',()=>{
 const session=completeDraft();const payload=buildSubmissionPayload(session);const h=createHarness();
 assert.deepEqual(Object.keys(payload).sort(),h.headers.filter(k=>k!=='server_received_at').sort());
 assert.equal(payload.submission_id,session.submission_id);assert.equal(payload.pre_ai_judgement,5);assert.equal(payload.post_ai_judgement,2);
 assert.deepEqual(JSON.parse(payload.explanation_factors_json),explainClassification(CASE_FEATURES,classifyProfile(CASE_FEATURES)));
 assert.equal(payload.experiment_version,'2.0.0');
});
test('empty endpoint rejects only the final submission',async()=>{
 const session=completeDraft();assert.equal(session.step,'questionnaire');
 await assert.rejects(sendSubmission(buildSubmissionPayload(session)),/The study data endpoint is not configured\./);
});
test('Apps Script validates all ratings, IDs, stimulus, timestamps and fields',()=>{
 const h=createHarness();const payload=buildSubmissionPayload(completeDraft());
 for(const key of ['pre_ai_judgement','post_ai_judgement',...QUESTIONS.map(([k])=>k)])for(const value of [0,8,1.5,'4',null])assert.equal(h.call({...payload,[key]:value}).error,'invalid_payload');
 for(const [key,value] of [['submission_id','not-uuid'],['condition','OTHER'],['created_at','invalid'],['feature_attention',4],['experiment_version','1.0.0'],['duration_seconds',-1],['test_mode','true'],['explanation_factors_json','bad-json'],['classification','=IMPORTDATA("https://example.org")']])assert.equal(h.call({...payload,[key]:value}).error,'invalid_payload');
 assert.equal(h.call({...payload,extra:'not-allowed'}).error,'invalid_payload');
 assert.equal(h.raw('{broken').error,'invalid_payload');assert.equal(h.raw('x'.repeat(16001)).error,'invalid_payload');
 const missing={...payload};delete missing.a1;assert.equal(h.call(missing).error,'invalid_payload');
 assert.equal(h.rows.length,1);
 assert.equal(h.call(payload).ok,true);assert.equal(h.rows.length,2);
 assert.ok(h.logs.every(message=>!message.includes(payload.submission_id)));
});
test('Apps Script duplicate check and write share a lock, with flush before release',()=>{
 const h=createHarness();const payload=buildSubmissionPayload(completeDraft());
 h.events.length=0;
 assert.deepEqual(h.call(payload),{ok:true,duplicate:false});assert.deepEqual(h.events,['lock','append','flush','release']);
 h.events.length=0;
 assert.deepEqual(h.call(payload),{ok:true,duplicate:true});assert.deepEqual(h.events,['lock','find','release']);
 assert.equal(h.rows.length,2);
 const row=Object.fromEntries(h.headers.map((key,i)=>[key,h.rows[1][i]]));assert.equal(row.submission_id,payload.submission_id);assert.ok(Date.parse(row.server_received_at));
 h.state.busy=true;assert.equal(h.call({...payload,submission_id:crypto.randomUUID()}).error,'busy_retry');assert.equal(h.rows.length,2);
 h.state.busy=false;h.state.failWrite=true;assert.equal(h.call({...payload,submission_id:crypto.randomUUID()}).error,'storage_error');assert.equal(h.state.held,false);
});
test('Apps Script setup is repeatable and refuses mismatched headers',()=>{
 const h=createHarness({setup:false});const payload=buildSubmissionPayload(completeDraft());
 assert.equal(h.call(payload).error,'setup_required');h.context.setup();h.context.setup();assert.equal(h.rows.length,1);
 h.rows[0][0]='wrong';assert.equal(h.call(payload).error,'header_mismatch');assert.equal(h.rows.length,1);
});

test('Chrome: both complete local flows, final POST only, visible questions and recovery', {skip:!process.env.TEST_TOOLS_DIR,timeout:180000},async()=>{
 const {serveApp,root,toolsDir}=await import('./helpers.mjs');const {pathToFileURL}=await import('node:url');const path=await import('node:path');
 const {chromium}=await import(pathToFileURL(path.join(toolsDir,'playwright/index.mjs')));
 const server=await serveApp();const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const artifacts=path.join(root,'tests/artifacts');fs.mkdirSync(artifacts,{recursive:true});
 const endpoint='https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';const report=[];
 async function visible(page,selector){await page.locator(selector).waitFor({state:'visible'});assert.ok(await page.locator('main').innerText());}
 async function fit(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Horizontal overflow');}
 async function capture(page,name){
  await fit(page);await page.screenshot({path:path.join(artifacts,name+'.png'),fullPage:true});
  if(['consent','case','pre','assessment','post'].some(stage=>name.endsWith('-'+stage))){
   const size=page.viewportSize();await page.setViewportSize({width:320,height:768});await fit(page);await page.screenshot({path:path.join(artifacts,name+'-mobile.png'),fullPage:true});await page.setViewportSize(size);
  }
 }
 async function config(context,settings){
  await context.route('**/js/config.js',async route=>{
   const response=await route.fetch();const source=(await response.text()).replace("export const APPS_SCRIPT_URL = '';",`export const APPS_SCRIPT_URL = '${settings.url}';`).replace('export const TEST_MODE = false;',`export const TEST_MODE = ${settings.test};`);
   await route.fulfill({response,body:source});
  });
 }
 try {
  let sharedAssessment;
  for(const condition of ['NO_XAI','XAI']){
   const h=createHarness();const settings={url:'',test:true};const context=await browser.newContext({viewport:{width:1365,height:768}});await config(context,settings);
   const page=await context.newPage();const errors=[],network=[],payloads=[];let failNetwork=false;
   page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   page.on('request',request=>{if(['fetch','xhr'].includes(request.resourceType()))network.push(request.method()+' '+request.url());});
   await context.route(endpoint,async route=>{
    payloads.push(route.request().postDataJSON());
    assert.equal(route.request().method(),'POST');assert.match(route.request().headers()['content-type'],/^text\/plain/);
    if(failNetwork){failNetwork=false;await route.abort('failed');return;}
    const response=h.call(payloads.at(-1));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
   });
   await page.goto(`http://127.0.0.1:8000/PERSUASIVE26/?condition=${condition}`);await visible(page,'#consent-check');await capture(page,`${condition}-consent`);
   assert.equal(await page.evaluate(()=>localStorage.getItem('hci_experiment_v1')),null);
   await page.locator('#consent-check').check();await page.locator('#agree').click();await visible(page,'.case-grid');
   assert.equal(await page.locator('main input,main select,main textarea').count(),0);await capture(page,`${condition}-case`);
   const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')));assert.equal(original.condition,null);assert.ok(original.submission_id);
   await page.reload();await visible(page,'.case-grid');await page.locator('#next').click();await visible(page,'#judgement-form');
   assert.equal(await page.locator('#judgement-next').isDisabled(),true);await page.locator('[name=pre_ai_judgement][value="5"]').check();await capture(page,`${condition}-pre`);
   await page.reload();await visible(page,'#judgement-form');assert.equal(await page.locator('[name=pre_ai_judgement][value="5"]').isChecked(),true);
   await page.locator('#judgement-next').click();await visible(page,'#assessment-text');
   const text=await page.locator('#assessment-text').innerText();if(sharedAssessment)assert.equal(text,sharedAssessment);sharedAssessment=text;
   assert.equal(await page.locator('#explanation').count(),condition==='XAI'?1:0);await capture(page,`${condition}-assessment`);
   const assigned=await page.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')));assert.equal(assigned.condition,condition);assert.equal(assigned.pre_locked,true);
   assert.equal(assigned.submission_id,original.submission_id);assert.equal(assigned.participant_id,original.participant_id);
   // A stale earlier screen is redirected locally to assessment once the pre is locked.
   await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('hci_experiment_v1'));s.step='pre';localStorage.setItem('hci_experiment_v1',JSON.stringify(s));});
   await page.reload();await visible(page,'#assessment-text');assert.equal(await page.locator('[name=pre_ai_judgement]').count(),0);
   await page.locator('#next').click();await visible(page,'[name=post_ai_judgement][value="1"]');assert.equal(await page.locator('#judgement-next').isDisabled(),true);
   assert.equal(await page.locator('[name=pre_ai_judgement]').count(),0);await page.locator('[name=post_ai_judgement][value="2"]').check();await capture(page,`${condition}-post`);
   await page.reload();assert.equal(await page.locator('[name=post_ai_judgement][value="2"]').isChecked(),true);await page.locator('#judgement-next').click();await visible(page,'#submit');
   assert.equal(await page.locator('fieldset').count(),13);assert.equal(await page.locator('input[required]').count(),91);assert.equal(await page.locator('#submit').isDisabled(),true);
   for(const [key,text] of QUESTIONS){
    const field=page.locator('fieldset').filter({has:page.locator(`[name=${key}]`)});assert.ok((await field.innerText()).includes(text));
    await field.scrollIntoViewIfNeeded();assert.ok(await field.isVisible());await page.locator(`[name=${key}][value="4"]`).check();
    if(key!=='mc1')assert.equal(await page.locator('#submit').isDisabled(),true);
   }
   await capture(page,`${condition}-questionnaire-desktop`);await page.reload();await visible(page,'#submit');assert.equal(await page.locator('input:checked').count(),13);
   await page.setViewportSize({width:320,height:768});await capture(page,`${condition}-questionnaire-mobile`);
   await page.setViewportSize({width:1365,height:768});await page.evaluate(()=>document.documentElement.style.zoom='2');await capture(page,`${condition}-questionnaire-zoom200`);await page.evaluate(()=>document.documentElement.style.zoom='');
   await page.locator('[name=mc1][value="4"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[name=mc1][value="5"]').isChecked(),true);
   assert.deepEqual(network,[]);assert.deepEqual(errors,[]);assert.equal(h.rows.length,1);
   await page.locator('#submit').click();await page.getByText('The study data endpoint is not configured.',{exact:true}).waitFor();assert.deepEqual(network,[]);
   assert.ok(errors.every(message=>message.includes('The study data endpoint is not configured.')));errors.length=0;
   // The endpoint is configured only now, for the final request. No script setup is needed to reach here.
   settings.url=endpoint;await page.reload();await visible(page,'#submit');
   if(condition==='XAI'){
    failNetwork=true;await page.locator('#submit').click();await page.locator('#error').filter({hasText:'Unable to send'}).waitFor();
    assert.equal(await page.locator('input:checked').count(),13);assert.equal(await page.locator('input:disabled').count(),91);errors.length=0;
    // A rejected server write is opaque too: never claim it was saved.
    h.state.failWrite=true;
   }
   await page.locator('#submit').click();await page.getByRole('heading',{name:'Your submission has been sent.'}).waitFor();
   assert.ok((await page.locator('main').innerText()).includes('cannot confirm whether your responses were saved'));
   assert.equal(h.rows.length,condition==='XAI'?1:2);assert.equal(await page.evaluate(()=>localStorage.getItem('experiment_completed')),'true');
   await capture(page,`${condition}-complete`);h.state.failWrite=false;
   await page.locator('#retry-submission').click();await page.getByRole('heading',{name:'Your submission has been sent.'}).waitFor();
   assert.equal(h.rows.length,2);await page.reload();await visible(page,'#retry-submission');await page.locator('#retry-submission').click();await visible(page,'#retry-submission');
   assert.equal(h.rows.length,2);assert.ok(payloads.length>=3);assert.ok(payloads.every(p=>JSON.stringify(p)===JSON.stringify(payloads[0])));
   assert.equal(payloads[0].submission_id,original.submission_id);assert.equal(payloads[0].pre_ai_judgement,5);assert.equal(payloads[0].post_ai_judgement,2);
   assert.deepEqual(errors,[]);
   await page.goto('http://127.0.0.1:8000/PERSUASIVE26/?debug=1');await visible(page,'#debug');assert.match(await page.locator('#debug').innerText(),new RegExp(original.submission_id));
   await page.locator('#reset').click();await visible(page,'#consent-check');assert.equal(await page.evaluate(()=>localStorage.getItem('experiment_completed')),null);
   report.push(`${condition}: complete local flow, no network before Submit, all 13 visible required items, desktop/mobile/zoom, keyboard, reloads, honest unconfirmed completion and idempotent final retries. Normal console: clean.`);
   await context.close();
  }
  const context=await browser.newContext();const settings={url:'',test:false};await config(context,settings);await context.addInitScript(()=>{Math.random=()=>0.1;});const page=await context.newPage();
  await page.goto('http://127.0.0.1:8000/?condition=XAI&debug=1');await visible(page,'#consent-check');assert.equal(await page.locator('#debug').count(),0);
  await page.locator('#consent-check').check();await page.locator('#agree').click();await visible(page,'.case-grid');await page.locator('#next').click();await page.locator('[name=pre_ai_judgement][value="4"]').check();await page.locator('#judgement-next').click();await visible(page,'#assessment-text');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')).condition),'NO_XAI');assert.equal(await page.locator('#explanation').count(),0);
  for(const raw of ['{broken',JSON.stringify({experiment_version:'1.1.0'}),JSON.stringify({experiment_version:'2.0.0'})]){
   await page.evaluate(value=>localStorage.setItem('hci_experiment_v1',value),raw);await page.reload();await visible(page,'#recover');await page.locator('#recover').click();await visible(page,'#consent-check');
  }
  await page.route('**/js/classifier.js',route=>route.fulfill({status:404,body:'missing'}));await page.reload();await page.getByRole('heading',{name:'Unable to open the study'}).waitFor();await page.unroute('**/js/classifier.js');
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.getByRole('heading',{name:'Unable to open the study'}).waitFor();assert.match(await page.locator('main').innerText(),/web server/);
  await context.close();
  report.push('Production ignores condition/debug parameters; corrupt/old state, root and Pages subpath, failed imports and file:// diagnostics verified. Apps Script services are test doubles; no live Google deployment used.');
  fs.writeFileSync(path.join(artifacts,'verification.txt'),report.join('\n')+'\n');
 }finally{await browser.close();await server.close();}
});
