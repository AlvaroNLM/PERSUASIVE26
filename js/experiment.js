import { TEST_MODE, EXPERIMENT_VERSION, CASE_VERSION } from './config.js';
import { CASE_FEATURES } from './case.js';
import { CLASSIFIER_VERSION } from './classifier.js';
import { isJudgement } from './questionnaire.js';
import { loadSession, saveSession, checkStorage } from './storage.js';
export function assignCondition(random = Math.random, search = location.search) {
  const forced = TEST_MODE && new URLSearchParams(search).get('condition');
  return ['XAI', 'NO_XAI'].includes(forced) ? forced : random() < 0.5 ? 'NO_XAI' : 'XAI';
}
export function beginSession() {
  checkStorage();
  let session = loadSession();
  if (!session) {
    session = {
      participant_id:crypto.randomUUID(), session_id:crypto.randomUUID(), submission_id:crypto.randomUUID(),
      created_at:new Date().toISOString(), condition:null, experiment_version:EXPERIMENT_VERSION, case_version:CASE_VERSION,
      classifier_version:CLASSIFIER_VERSION, step:'case', answers:{}, features:{...CASE_FEATURES}, test_mode:TEST_MODE,
      pre_locked:false, pre_ai_judgement:null, post_ai_judgement:null, final_payload:null,
    };
    saveSession(session);
  }
  return session;
}
export function lockPreJudgement(session) {
  // Respect a judgement already locked by another tab of the same session.
  const stored = loadSession();
  if (stored?.session_id === session.session_id && stored.pre_locked) { Object.assign(session,stored); return; }
  if (!isJudgement(session.pre_ai_judgement)) throw new Error('Please choose a value from 1 to 7.');
  if (session.pre_locked) return;
  session.condition ??= assignCondition();
  session.pre_locked = true;
  session.step = 'assessment';
  // One local write locks the pre response and assignment before showing the AI.
  saveSession(session);
}
