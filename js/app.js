import { TEST_MODE, FUNCTION_URL } from './config.js';
import { FEATURE_KEYS, FREQUENCIES, CASE_FEATURES, classifyProfile, explainClassification, CLASSIFIER_VERSION } from './classifier.js';
import { QUESTIONS, questionnaireMarkup } from './questionnaire.js';
import { loadSession, saveSession, isCompleted, completeSession, clearTestSession, clearSession, SessionStateError } from './storage.js';
import { api, beginSession, sessionRequest, lockPreJudgement, syncSession } from './experiment.js';
import { isJudgement } from '../supabase/functions/_shared/protocol.js';
const main = document.querySelector('main');
let session;
const assessment = 'Based on the information provided, the system considers this profile more consistent with ADHD-related characteristics than ASD-related characteristics.';
function show(html, step = 0) {
 main.innerHTML = `${step ? `<div class="step-label">STEP ${step} OF 6</div><div class="progress" aria-label="Step ${step} of 6">${[1,2,3,4,5,6].map(n => `<span class="${n <= step ? 'active' : ''}"></span>`).join('')}</div>` : ''}${html}<p class="error" role="alert" id="error"></p>`;
 main.focus(); window.scrollTo(0, 0);
}
function error(err) {
 console.error('Study error:', err);
 let message=document.querySelector('#error');
 if(!message && main){message=document.createElement('p');message.id='error';message.className='error';message.setAttribute('role','alert');main.append(message);}
 if(message)message.textContent=err?.message || 'An unexpected error occurred. Please reload to resume your saved progress.';
}
// PROVISIONAL CONSENT: institutional details and retention policy require review.
function consent() {
 show(`<div class="eyebrow">Research Study</div><h1>Information and consent</h1><div class="card"><p>This academic study explores human–AI interaction. You will read a fictional case, evaluate information produced by an experimental AI system, and answer questions about your own judgement.</p><p>The system does not provide a clinical diagnosis. Participation is voluntary. You may stop at any point by closing this page. Your initial judgement is saved before the AI assessment; your final questionnaire is saved when you submit it.</p><p>We store random session identifiers, your study responses and timing. Draft responses remain in this browser so you can resume. We do not request names, contact details or location, and do not use fingerprinting.</p><p id="privacy">Study records do not store your full IP address. If connection hashing is enabled, we will show additional information before you begin. Hosting providers may retain their own connection logs.</p><form id="consent-form"><label class="consent-check"><input type="checkbox" required id="consent-check"> I have read this information and voluntarily agree to participate.</label><div class="actions"><button id="agree">I agree to participate</button></div></form></div>`,1);
 document.querySelector('#consent-form').onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector('#agree'); button.disabled = true;
  try {
   const settings = await api({action:'config'});
   if(settings.ipHashEnabled && !document.querySelector('#hash-consent')) {
    document.querySelector('#privacy').textContent = 'The server temporarily processes your IP to create a salted SHA-256 hash for duplicate detection. Only this pseudonymous hash is stored in study records. The application discards the original IP. Hosting providers may retain their own connection logs.';
    const label=document.createElement('label'); label.className='consent-check';
    const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.required=true; checkbox.id='hash-consent';
    label.append(checkbox,document.createTextNode(' I agree to participation with the connection hashing described above.'));
    button.closest('.actions').before(label); checkbox.focus(); button.disabled=false; return;
   }
   session=await beginSession(); render();
  } catch(err) { error(err); button.disabled=false; }
 };
}
const caseLabels = ['Difficulty sustaining attention during long tasks', 'Easily distracted by external stimuli', 'Impulsive responding', 'Difficulty dealing with unexpected changes', 'Difficulty interpreting social cues', 'Repetitive behaviours or interests'];
function casePage() {
 show(`<h1>Fictional case: Alex</h1><p>Please imagine that the following information refers to a fictional individual named Alex.</p><p>The system shown in this study is intended for research on AI-assisted interpretation and does not provide a clinical diagnosis.</p><div class="card"><dl class="case-grid">${FEATURE_KEYS.map((k,i) => `<dt>${caseLabels[i]}</dt><dd>${FREQUENCIES[CASE_FEATURES[k]]}</dd>`).join('')}</dl></div><div class="actions"><button id="next">Continue</button></div>`,2);
 document.querySelector('#next').onclick = () => advance('pre');
}
function advance(step) {
 try { session.step=step; saveSession(session); render(); } catch(err) { error(err); }
}
const judgementAnchors = ['Much more consistent with ADHD-related characteristics', 'Unsure / equally consistent', 'Much more consistent with ASD-related characteristics'];
function judgementPage(kind) {
 const pre = kind === 'pre';
 if (pre && session.pre_locked) { advance('assessment'); return; }
 const key = pre ? 'pre_ai_judgement' : 'post_ai_judgement';
 const title = pre ? 'Your initial judgement' : 'Your judgement after seeing the AI assessment';
 const question = pre ? "Before seeing the AI system's assessment, based only on the information presented above, how would you interpret this profile?" : "After seeing the AI system's assessment, how would you now interpret this profile?";
 show(`<h1>${title}</h1><form id="judgement-form"><fieldset><legend>${question}</legend><div class="likert judgement-scale">${Array.from({length:7},(_,i) => `<label><input type="radio" name="${key}" value="${i+1}" required ${session[key]===i+1?'checked':''}><span>${i+1}</span><span class="sr-only">${i===0?judgementAnchors[0]:i===3?judgementAnchors[1]:i===6?judgementAnchors[2]:''}</span></label>`).join('')}</div><div class="judgement-anchors"><p><strong>1</strong> = ${judgementAnchors[0]}</p><p><strong>4</strong> = ${judgementAnchors[1]}</p><p><strong>7</strong> = ${judgementAnchors[2]}</p></div></fieldset><div class="actions"><button id="judgement-next" ${isJudgement(session[key])?'':'disabled'}>Continue</button></div></form>`,pre?3:5);
 const form=document.querySelector('form'); const button=document.querySelector('#judgement-next');
 form.onchange=()=>{try {const value=Number(new FormData(form).get(key)); if(!isJudgement(value))throw new Error('Please choose a value from 1 to 7.');session[key]=value;saveSession(session);button.disabled=false;}catch(err){error(err);}};
 form.onsubmit=async event=>{
  event.preventDefault(); button.disabled=true;
  try {
   if(!isJudgement(session[key]))throw new Error('Please choose a value from 1 to 7.');
   if(pre){await lockPreJudgement(session); render();}else advance('questionnaire');
  }catch(err){error(err);button.disabled=false;}
 };
}
function assessmentPage() {
 const result = classifyProfile(CASE_FEATURES);
 const factors = explainClassification(CASE_FEATURES, result.classification);
 show(`<h1>AI-assisted assessment</h1><div class="card"><p id="assessment-text">${assessment}</p><p class="note">This output is generated by an experimental research prototype and should not be interpreted as a clinical diagnosis.</p>${session.condition === 'XAI' ? `<section id="explanation"><h2>Why did the system reach this conclusion?</h2><ul>${factors.map(f => `<li>${f.text}</li>`).join('')}</ul></section>` : ''}</div><div class="actions"><button id="next">Continue</button></div>`,4);
 document.querySelector('#next').onclick = () => advance('post');
}
function questionnairePage() {
 show(`<h1>Questionnaire</h1><p>Thinking about the assessment you just saw, indicate how much you agree with each statement.</p><p class="note">1 = Strongly disagree &nbsp; · &nbsp; 7 = Strongly agree<br>All 13 statements require a response.</p><form>${questionnaireMarkup(session.answers)}<div class="actions"><button id="submit" disabled>Submit responses</button></div><p>Your completed questionnaire is submitted when you press this button.</p></form>`,6);
 const form = document.querySelector('form');
 const complete = () => QUESTIONS.every(([k]) => isJudgement(session.answers[k]));
 const updateSubmit = () => {document.querySelector('#submit').disabled = !complete();};
 updateSubmit();
 form.onchange = () => {try {session.answers = Object.fromEntries([...new FormData(form)].map(([k,v]) => [k,Number(v)])); saveSession(session);updateSubmit();}catch(err){error(err);}};
 form.onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector('#submit'); button.disabled = true; button.textContent='Saving…';
  try {
   if(QUESTIONS.some(([k]) => !Number.isInteger(session.answers[k]) || session.answers[k]<1 || session.answers[k]>7)) throw new Error('Please answer every statement.');
   await api({...sessionRequest(session,'submit'), condition:session.condition, features:{...CASE_FEATURES}, answers:session.answers, pre_ai_judgement:session.pre_ai_judgement, post_ai_judgement:session.post_ai_judgement, classifier_version:CLASSIFIER_VERSION});
   completeSession(); finished();
  } catch(err) {error(err); button.disabled=false; button.textContent='Submit responses';}
 };
}
function finished() {show('<div class="eyebrow">STUDY COMPLETE</div><h1>Thank you for taking part.</h1><div class="card"><h2>Your responses have been saved.</h2><p>Your perspective contributes to research on how people interpret AI-assisted information. You may now close this page.</p><p>This study used a fictional profile and a simple research classifier. Its assessment has no clinical validity.</p></div>');}
function render() {
 if(session.test_mode !== TEST_MODE) throw new Error('Study settings have changed. Please contact the researcher.');
 if(session.pre_locked && ['case','pre'].includes(session.step)) session.step='assessment';
 const screens = {case:casePage, pre:()=>judgementPage('pre'), assessment:assessmentPage, post:()=>judgementPage('post'), questionnaire:questionnairePage};
 if(!screens[session.step]) throw new SessionStateError('The saved study step is invalid.');
 screens[session.step]();
}
function debug() {
 show('<h1>Development debug</h1><pre id="debug"></pre><button id="reset">Reset local test session</button>');
 const s=loadSession(); let result=null; try {result=classifyProfile(s?.features);} catch {}
 document.querySelector('#debug').textContent=JSON.stringify({participant_id:s?.participant_id,condition:s?.condition,classification:result?.classification,explanationFactors:result?.explanationFactors},null,2);
 document.querySelector('#reset').onclick=()=>{clearTestSession();location.href='./';};
}
function recover(err) {
 console.error('Study state recovery:', err);
 show('<h1>Unable to resume the saved session</h1><p>The saved session is damaged, incomplete, or belongs to an earlier study version. You can clear this local draft and return to the study information. Previously submitted responses will not be removed.</p><button id="recover">Clear saved draft and return to consent</button>');
 error(err);
 document.querySelector('#recover').onclick=()=>{try{clearSession();session=null;consent();}catch(error){recover(error);}};
}
async function resume() {
 show('<h1>Resuming your study</h1><p>Checking your saved progress…</p>');
 try { if(await syncSession(session)){completeSession();finished();}else render(); }
 catch(err){show('<h1>Your progress is saved on this device</h1><p>We could not verify the saved session. Please retry to continue.</p><button id="retry">Retry</button>');error(err);document.querySelector('#retry').onclick=resume;}
}
export async function initialize() {
 if (!main) throw new Error('Missing #main element');
 if (typeof TEST_MODE !== 'boolean' || typeof FUNCTION_URL !== 'string') throw new Error('Invalid public study configuration');
 try {
  // Consent needs neither working storage nor a configured backend to render.
  if(TEST_MODE && new URLSearchParams(location.search).get('debug')==='1'){debug();return;}
  if(isCompleted()){show('<h1>You have already completed this study.</h1><p>Thank you for your participation. You may close this page.</p>');return;}
  session=loadSession();
  if(session?.registered) await resume(); else consent();
 }catch(err){if(err instanceof SessionStateError)recover(err);else{consent();error(err);}}
}
// An uncaught event-handler failure must remain visible and diagnosable.
window.addEventListener('error',event=>{if(event.error)error(event.error);});
window.addEventListener('unhandledrejection',event=>error(event.reason instanceof Error?event.reason:new Error(String(event.reason))));
window.addEventListener('pageshow',event=>{if(event.persisted)initialize();});
