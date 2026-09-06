import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyProfile, explainClassification, CASE_FEATURES, FEATURE_KEYS} from '../js/classifier.js';
import {assignCondition} from '../js/experiment.js';
import {QUESTIONS, questionnaireMarkup} from '../js/questionnaire.js';
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
test('session, assignment and draft survive reload; completion clears draft',()=>{
 const entries=new Map(); globalThis.localStorage={setItem:(k,v)=>entries.set(k,String(v)),getItem:k=>entries.get(k)??null,removeItem:k=>entries.delete(k)};
 checkStorage(); const session={participant_id:crypto.randomUUID(),session_id:crypto.randomUUID(),token:crypto.randomUUID(),condition:'XAI',answers:{a1:7},experiment_version:'1.1.0',case_version:'alex_v1',test_mode:false,registered:true,pre_locked:true,pre_ai_judgement:4,post_ai_judgement:null,features:{...CASE_FEATURES},step:'assessment'};
 saveSession(session); assert.deepEqual(loadSession(),session); assert.equal(isCompleted(),false);
 completeSession(); assert.equal(isCompleted(),true); assert.equal(loadSession(),null);
});
test('questionnaire has 13 required numeric scales',()=>{
 assert.equal(QUESTIONS.length,13);assert.equal(new Set(QUESTIONS.map(([k])=>k)).size,13);
 const html=questionnaireMarkup({a1:7});assert.equal((html.match(/type="radio"/g)||[]).length,91);assert.equal((html.match(/ required /g)||[]).length,91);
});
test('static module imports resolve, including the Pages shared classifier',()=>{
 for(const dir of ['js','supabase/functions/_shared'])for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){
  const source=fs.readFileSync(`${dir}/${file}`,'utf8');
  for(const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) assert.ok(fs.existsSync(new URL(match[1],new URL(`../${dir}/${file}`,import.meta.url))));
 }
 assert.ok(fs.existsSync('.nojekyll'));
});

test('initial judgement validation and corrupt/old storage are explicit',async()=>{
 const {isJudgement}=await import('../supabase/functions/_shared/protocol.js');
 for(const value of [0,8,1.5,'4',null,undefined])assert.equal(isJudgement(value),false);
 for(let i=1;i<=7;i++)assert.equal(isJudgement(i),true);
 for(const raw of ['{broken',JSON.stringify({experiment_version:'1.0.0'}),JSON.stringify({experiment_version:'1.1.0'})]){
  localStorage.setItem('hci_experiment_v1',raw);assert.throws(loadSession,SessionStateError);
 }
 localStorage.removeItem('hci_experiment_v1');
});
test('explanation API rejects inconsistent classification',()=>{
 assert.deepEqual(explainClassification(CASE_FEATURES,'ADHD_RELATED'),classifyProfile(CASE_FEATURES).explanationFactors);
 assert.throws(()=>explainClassification(CASE_FEATURES,'ASD_RELATED'));
});

// The same suite can run its real-browser/database checks with optional external tools.
const integrationEnabled=Boolean(process.env.TEST_TOOLS_DIR);
test('Edge Function with real PostgreSQL: locks, validation, RLS and duplicate submissions', {skip:!integrationEnabled}, async()=>{
 const {createHarness}=await import('./helpers.mjs');const h=await createHarness();
 try {
  const base={participant_id:crypto.randomUUID(),session_id:crypto.randomUUID(),token:crypto.randomUUID(),experiment_version:'1.1.0',case_version:'alex_v1'};
  assert.equal((await h.call({...base,action:'start',test_mode:true})).status,200);
  assert.equal((await h.call({...base,action:'start',test_mode:true})).status,200);
  for(const value of [0,8,1.5,'4',null])assert.equal((await h.call({...base,action:'pre',condition:'XAI',pre_ai_judgement:value})).status,400);
  assert.equal((await h.call({...base,action:'pre',condition:'OTHER',pre_ai_judgement:4})).status,400);
  assert.equal((await h.call({...base,action:'pre',condition:'XAI',pre_ai_judgement:5})).status,200);
  const repeat=await h.call({...base,action:'pre',condition:'NO_XAI',pre_ai_judgement:1});
  assert.deepEqual(repeat.body,{condition:'XAI',pre_ai_judgement:5});
  await assert.rejects(h.database.query('update experiment_sessions set pre_ai_judgement=1 where session_id=$1',[base.session_id]));
  const payload={...base,action:'submit',condition:'XAI',features:{...CASE_FEATURES},answers:Object.fromEntries(QUESTIONS.map(([k])=>[k,4])),classifier_version:'1.0.0',pre_ai_judgement:5,post_ai_judgement:2};
  for(const key of ['pre_ai_judgement','post_ai_judgement'])for(const value of [0,8,1.5,'4',null])assert.equal((await h.call({...payload,[key]:value})).status,400);
  assert.equal((await h.call({...payload,pre_ai_judgement:4})).status,400);
  assert.equal((await h.call({...payload,condition:'NO_XAI'})).status,400);
  assert.equal((await h.call({...payload,features:{...CASE_FEATURES,distractibility:0}})).status,400);
  for(const value of [0,8,1.5,'4',null])assert.equal((await h.call({...payload,answers:{...payload.answers,a1:value}})).status,400);
  assert.equal((await h.call({...payload,token:crypto.randomUUID()})).status,403);
  assert.equal((await h.call({...payload,raw_ip:'forbidden'})).status,400);
  const responses=await Promise.all([h.call(payload),h.call(payload)]);assert.ok(responses.every(r=>r.status===200));
  assert.equal((await h.call(payload)).status,200);
  const saved=(await h.database.query('select * from experiment_responses')).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].pre_ai_judgement,5);assert.equal(saved[0].post_ai_judgement,2);assert.equal(saved[0].ip_hash,null);assert.equal(saved[0].case_version,'alex_v1');
  assert.equal((await h.call({...base,action:'resume'})).body.completed,true);
  for(const role of ['anon','authenticated']){
   await h.database.exec(`set role ${role}`);
   await assert.rejects(h.database.query('select * from experiment_responses'));
   await assert.rejects(h.database.query('insert into experiment_sessions (session_id) values (gen_random_uuid())'));
   await h.database.exec('reset role');
  }
  h.settings.RATE_LIMIT_PER_MINUTE='1';assert.equal((await h.call({action:'config'})).status,429);
 }finally{await h.close();}
});

test('Chrome: complete both conditions, all visible questions, responsive and recovery', {skip:!integrationEnabled,timeout:240000}, async()=>{
 const {createHarness,serveApp,root,toolsDir}=await import('./helpers.mjs');
 const {pathToFileURL}=await import('node:url');const path=await import('node:path');
 const {chromium}=await import(pathToFileURL(path.join(toolsDir,'playwright/index.mjs')));
 const h=await createHarness();const server=await serveApp(h);
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const artifacts=path.join(root,'tests/artifacts');fs.mkdirSync(artifacts,{recursive:true});
 const report=[];
 async function visible(page,selector){await page.locator(selector).waitFor({state:'visible'});assert.ok(await page.locator('main').innerText());assert.ok(await page.locator(selector).isVisible());}
 async function fit(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Horizontal overflow');}
 async function screenshot(page,name){
  await fit(page);await page.screenshot({path:path.join(artifacts,name+'.png'),fullPage:true});
  if(['consent','case','pre','assessment','post'].some(stage=>name.endsWith('-'+stage))){
   const size=page.viewportSize();await page.setViewportSize({width:320,height:768});await fit(page);
   await page.screenshot({path:path.join(artifacts,name+'-mobile.png'),fullPage:true});
   await page.setViewportSize(size);
  }
 }
 try {
  let assessmentText;
  for(const condition of ['NO_XAI','XAI']) {
   const context=await browser.newContext({viewport:{width:1365,height:768}});const page=await context.newPage();
   const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   await page.goto(`http://127.0.0.1:8000/PERSUASIVE26/?condition=${condition}`);
   await visible(page,'#consent-check');await screenshot(page,`${condition}-consent`);
   assert.equal((await h.database.query('select * from experiment_sessions')).rows.length,condition==='NO_XAI'?0:1);
   await page.locator('#consent-check').check();await page.locator('#agree').click();
   await visible(page,'.case-grid');assert.equal(await page.locator('main input,main select,main textarea').count(),0);
   const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')));assert.equal(initial.condition,null);
   await screenshot(page,`${condition}-case`);await page.reload();await visible(page,'.case-grid');
   await page.locator('#next').click();await visible(page,'#judgement-form');
   assert.equal(await page.locator('#judgement-next').isDisabled(),true);
   await page.locator('[name=pre_ai_judgement][value="5"]').check();await screenshot(page,`${condition}-pre`);
   await page.reload();await visible(page,'#judgement-form');assert.equal(await page.locator('[name=pre_ai_judgement][value="5"]').isChecked(),true);
   await page.locator('#judgement-next').click();await visible(page,'#assessment-text');
   const text=await page.locator('#assessment-text').innerText();if(assessmentText)assert.equal(text,assessmentText);assessmentText=text;
   assert.equal(await page.locator('#explanation').count(),condition==='XAI'?1:0);
   const assigned=await page.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')));
   assert.equal(assigned.condition,condition);assert.equal(assigned.participant_id,initial.participant_id);assert.equal(assigned.pre_locked,true);
   await screenshot(page,`${condition}-assessment`);
   // Even a stale tab's earlier step cannot unlock the initial judgement after reload.
   await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('hci_experiment_v1'));s.step='pre';s.pre_ai_judgement=7;localStorage.setItem('hci_experiment_v1',JSON.stringify(s));});
   await page.reload();await visible(page,'#assessment-text');assert.equal(await page.locator('[name=pre_ai_judgement]').count(),0);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')).pre_ai_judgement),5);
   await page.locator('#next').click();await visible(page,'[name=post_ai_judgement][value="1"]');
   assert.equal(await page.locator('[name=pre_ai_judgement]').count(),0);
   await page.locator('[name=post_ai_judgement][value="2"]').check();await screenshot(page,`${condition}-post`);
   await page.locator('#judgement-next').click();await visible(page,'#submit');
   assert.equal(await page.locator('fieldset').count(),13);assert.equal(await page.locator('input[required]').count(),91);
   assert.equal(await page.locator('#submit').isDisabled(),true);
   for(const [key,text] of QUESTIONS){
    const field=page.locator('fieldset').filter({has:page.locator(`[name=${key}]`)});
    assert.ok((await field.innerText()).includes(text));await field.scrollIntoViewIfNeeded();assert.ok(await field.isVisible());
    await page.locator(`[name=${key}][value="4"]`).check();
    if(key!=='mc1')assert.equal(await page.locator('#submit').isDisabled(),true);
   }
   await screenshot(page,`${condition}-questionnaire-desktop`);
   await page.reload();await visible(page,'#submit');assert.equal(await page.locator('input:checked').count(),13);
   await page.setViewportSize({width:320,height:768});await fit(page);await screenshot(page,`${condition}-questionnaire-mobile`);
   await page.setViewportSize({width:1365,height:768});
   await page.evaluate(()=>document.documentElement.style.zoom='2');await fit(page);await screenshot(page,`${condition}-questionnaire-css-zoom-200`);
   await page.evaluate(()=>document.documentElement.style.zoom='');
   await page.setViewportSize({width:682,height:384}); // 1365x768 at 200% browser zoom: half the CSS viewport.
   await fit(page);await screenshot(page,`${condition}-questionnaire-200-percent`);
   // Keyboard focus and arrow navigation operate the native radios.
   await page.locator('[name=mc1][value="4"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[name=mc1][value="5"]').isChecked(),true);
   if(condition==='XAI'){
    let drop=true;
    await page.route('**/api',async route=>{
     if(route.request().postDataJSON().action==='submit' && drop){drop=false;await route.fetch();await route.abort('failed');}else await route.continue();
    });
    await page.locator('#submit').click();await page.locator('#error').filter({hasText:'Unable to connect'}).waitFor();
    assert.equal(await page.locator('input:checked').count(),13);
    assert.ok(errors.length>0);errors.length=0; // These diagnostics are expected for the injected failure.
   }
   await page.locator('#submit').click();await page.getByRole('heading',{name:'Your responses have been saved.'}).waitFor();
   await screenshot(page,`${condition}-complete`);
   await page.reload();await page.getByRole('heading',{name:'You have already completed this study.'}).waitFor();
   assert.deepEqual(errors,[]);report.push(`${condition}: consent, fixed case, pre, assessment, post, all 13 items and completion; reloads, subpath, 320px and 200% equivalent CSS viewport; no console errors.`);
   await context.close();
  }
  // Initial UI renders with no backend configured, and network failures are actionable.
  h.frontendURL='';const context=await browser.newContext({viewport:{width:320,height:768}});const page=await context.newPage();
  await page.goto('http://127.0.0.1:8000/');await visible(page,'#consent-check');await fit(page);await screenshot(page,'unconfigured-consent-mobile');
  await page.locator('#consent-check').check();await page.locator('#agree').click();await page.getByText('The study is not configured yet.',{exact:false}).waitFor();
  assert.ok(await page.locator('#consent-check').isVisible());
  for(const raw of ['{broken',JSON.stringify({experiment_version:'1.0.0'}),JSON.stringify({experiment_version:'1.1.0'})]){
   await page.evaluate(value=>localStorage.setItem('hci_experiment_v1',value),raw);await page.reload();await visible(page,'#recover');await page.locator('#recover').click();await visible(page,'#consent-check');
  }
  h.frontendURL=undefined;
  await page.reload();await visible(page,'#consent-check');await page.route('**/api',route=>route.abort('failed'));
  await page.locator('#consent-check').check();await page.locator('#agree').click();await page.locator('#error').filter({hasText:'Unable to connect'}).waitFor();await visible(page,'#consent-check');await page.unroute('**/api');
  await page.route('**/js/config.js',route=>route.fulfill({status:404,body:'missing'}));await page.reload();await page.getByRole('heading',{name:'Unable to open the study'}).waitFor();await page.unroute('**/js/config.js');
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.getByRole('heading',{name:'Unable to open the study'}).waitFor();assert.match(await page.locator('main').innerText(),/web server/);
  await context.close();
  // Production ignores both forced assignment and debug. Fix RNG to make this deterministic.
  h.frontendURL=undefined;h.settings.TEST_MODE='false';
  const production=await browser.newContext();await production.addInitScript(()=>{Math.random=()=>0.1;});const prod=await production.newPage();
  await prod.goto('http://127.0.0.1:8000/PERSUASIVE26/?condition=XAI&debug=1');await visible(prod,'#consent-check');assert.equal(await prod.locator('#debug').count(),0);
  await prod.locator('#consent-check').check();await prod.locator('#agree').click();await visible(prod,'.case-grid');await prod.locator('#next').click();await prod.locator('[name=pre_ai_judgement][value="4"]').check();await prod.locator('#judgement-next').click();await visible(prod,'#assessment-text');
  assert.equal(await prod.evaluate(()=>JSON.parse(localStorage.getItem('hci_experiment_v1')).condition),'NO_XAI');assert.equal(await prod.locator('#explanation').count(),0);await production.close();
  report.push('Unconfigured backend, corrupted/old state, missing module, file://, production forced-condition/debug rejection verified.');
  fs.writeFileSync(path.join(artifacts,'verification.txt'),report.join('\n')+'\n');
 }finally{await browser.close();await server.close();await h.close();}
});

test('migration preserves legacy records and requires new pre/post data', {skip:!integrationEnabled},async()=>{
 const {toolsDir,root}=await import('./helpers.mjs');const {pathToFileURL}=await import('node:url');const path=await import('node:path');
 const {PGlite}=await import(pathToFileURL(path.join(toolsDir,'@electric-sql/pglite/dist/index.js')));
 const database=new PGlite();
 try {
  await database.exec('create role anon;create role authenticated;create role service_role;');
  // Reconstruct the original schema by removing precisely the new schema additions.
  let legacy=fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8').split('create function public.lock_experiment_pre')[0];
  legacy=legacy.replace(' condition text check',' condition text not null check');
  legacy=legacy.replace(' experiment_version text not null,\n',''); // Session column only; response version already existed.
  legacy=legacy.split('\n').filter(line=>!/^ (case_version|pre_ai_judgement|post_ai_judgement|pre_recorded_at) /.test(line)).join('\n');
  await database.exec(legacy);
  const sid=crypto.randomUUID(),pid=crypto.randomUUID();
  await database.query("insert into experiment_sessions(session_id,participant_id,token_hash,condition) values($1,$2,'legacy-token','XAI')",[sid,pid]);
  const row={participant_id:pid,session_id:sid,condition:'XAI',created_at:new Date().toISOString(),classification:'ADHD_RELATED',explanation_factors:'[]',duration_seconds:10,experiment_version:'1.0.0',classifier_version:'1.0.0',...Object.fromEntries(QUESTIONS.map(([k])=>[k,4])),...Object.fromEntries('attention distractibility impulsivity changes social_communication repetitive_behaviours'.split(' ').map(k=>['case_'+k,0]))};
  const keys=Object.keys(row);await database.query(`insert into experiment_responses(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
  await database.exec(fs.readFileSync(path.join(root,'supabase/migrations/202609060001_pre_post.sql'),'utf8'));
  const old=(await database.query('select * from experiment_responses')).rows[0];assert.equal(old.experiment_version,'1.0.0');assert.equal(old.pre_ai_judgement,null);assert.equal(old.case_version,null);
  await assert.rejects(database.query("update experiment_responses set experiment_version='1.1.0'"));
  assert.equal((await database.query("select * from lock_experiment_pre($1,'legacy-token',4,'NO_XAI')",[sid])).rows.length,0);
  const sid2=crypto.randomUUID();await database.query("insert into experiment_sessions(session_id,participant_id,token_hash,condition,experiment_version,case_version) values($1,$2,'new-token',null,'1.1.0','alex_v1')",[sid2,crypto.randomUUID()]);
  assert.deepEqual((await database.query("select * from lock_experiment_pre($1,'new-token',4,'NO_XAI')",[sid2])).rows[0],{pre_ai_judgement:4,condition:'NO_XAI'});
 }finally{await database.close();}
});
