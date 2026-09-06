import { TEST_MODE, FUNCTION_URL, EXPERIMENT_VERSION, CASE_VERSION } from './config.js';
import { CASE_FEATURES } from './classifier.js';
import { isJudgement } from '../supabase/functions/_shared/protocol.js';
import { loadSession, saveSession, checkStorage } from './storage.js';
export function assignCondition(random = Math.random, search = location.search) {
  const forced = TEST_MODE && new URLSearchParams(search).get('condition');
  return ['XAI', 'NO_XAI'].includes(forced) ? forced : random() < 0.5 ? 'NO_XAI' : 'XAI';
}
export async function api(body) {
  if (!FUNCTION_URL) throw new Error('The study is not configured yet. Please contact the researcher.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(FUNCTION_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body), signal:controller.signal });
    let result;
    try { result = await response.json(); } catch { throw new Error('The study server returned an unreadable response. Please retry.'); }
    if (!response.ok) throw new Error(result.error || 'Unable to save. Please try again.');
    return result;
  } catch (error) {
    console.error('Study request failed:', body.action, error); // Never log tokens or response bodies.
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Unable to connect to the study server. Your progress is preserved. Please try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
export function sessionRequest(session, action) {
  return { action, participant_id:session.participant_id, session_id:session.session_id, token:session.token, experiment_version:EXPERIMENT_VERSION, case_version:CASE_VERSION };
}
export async function beginSession() {
  checkStorage();
  let session = loadSession();
  if (!session) {
    session = {participant_id:crypto.randomUUID(), session_id:crypto.randomUUID(), token:crypto.randomUUID(), condition:null, experiment_version:EXPERIMENT_VERSION, case_version:CASE_VERSION, step:'case', answers:{}, features:{...CASE_FEATURES}, test_mode:TEST_MODE, registered:false, pre_locked:false, pre_ai_judgement:null, post_ai_judgement:null};
    saveSession(session);
  }
  if (!session.registered) {
    await api({...sessionRequest(session,'start'), test_mode:TEST_MODE});
    session.registered = true;
    saveSession(session);
  }
  return session;
}
export async function lockPreJudgement(session) {
  if (!isJudgement(session.pre_ai_judgement)) throw new Error('Please choose a value from 1 to 7.');
  if (session.pre_locked) return;
  // Assignment happens once, after the initial judgement, and is persisted before networking.
  session.condition ??= assignCondition();
  saveSession(session);
  const result = await api({...sessionRequest(session,'pre'), condition:session.condition, pre_ai_judgement:session.pre_ai_judgement});
  session.condition = result.condition;
  session.pre_ai_judgement = result.pre_ai_judgement;
  session.pre_locked = true;
  session.step = 'assessment';
  saveSession(session);
}
export async function syncSession(session) {
  const result = await api(sessionRequest(session,'resume'));
  if (result.pre_ai_judgement !== null) {
    if (!isJudgement(result.pre_ai_judgement) || !['XAI','NO_XAI'].includes(result.condition)) throw new Error('Invalid saved assessment state.');
    session.pre_ai_judgement = result.pre_ai_judgement;
    session.condition = result.condition;
    session.pre_locked = true;
    if (['case','pre'].includes(session.step)) session.step = 'assessment';
  } else if (session.pre_locked) throw new Error('The saved session does not match the server. Please contact the researcher.');
  saveSession(session);
  return result.completed === true;
}
