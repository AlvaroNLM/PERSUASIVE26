import { EXPERIMENT_VERSION, CASE_VERSION, TEST_MODE } from './config.js';
import { CASE_FEATURES, FEATURE_KEYS } from './case.js';
import { CLASSIFIER_VERSION } from './classifier.js';
import { buildSubmissionPayload } from './submission.js';
import { QUESTIONS, isJudgement } from './questionnaire.js';
const KEY = 'hci_experiment_v1'; // Stable key lets us detect earlier experiment versions.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class SessionStateError extends Error {}
export function checkStorage() {
  localStorage.setItem('hci_storage_check', '1');
  localStorage.removeItem('hci_storage_check');
}
export function validateSession(s) {
  if (!s || s.experiment_version !== EXPERIMENT_VERSION || s.case_version !== CASE_VERSION || s.test_mode !== TEST_MODE || s.classifier_version !== CLASSIFIER_VERSION) return false;
  if (!['participant_id','session_id','submission_id'].every(k => typeof s[k] === 'string' && UUID.test(s[k]))) return false;
  if (!['case','pre','assessment','post','questionnaire','complete'].includes(s.step) || typeof s.pre_locked !== 'boolean') return false;
  if (typeof s.created_at !== 'string' || !Number.isFinite(Date.parse(s.created_at))) return false;
  if (!(s.condition === null || ['XAI','NO_XAI'].includes(s.condition))) return false;
  if (!s.features || FEATURE_KEYS.some(k => s.features[k] !== CASE_FEATURES[k])) return false;
  if (!s.answers || Array.isArray(s.answers) || typeof s.answers !== 'object' || Object.entries(s.answers).some(([k,v]) => !QUESTIONS.some(([id]) => id === k) || !isJudgement(v))) return false;
  if (![s.pre_ai_judgement,s.post_ai_judgement].every(v => v === null || isJudgement(v))) return false;
  if (s.pre_locked && (!isJudgement(s.pre_ai_judgement) || !s.condition)) return false;
  if (['assessment','post','questionnaire','complete'].includes(s.step) && !s.pre_locked) return false;
  if (['questionnaire','complete'].includes(s.step) && !isJudgement(s.post_ai_judgement)) return false;
  if (s.step === 'complete' && !s.final_payload) return false;
  if (s.final_payload !== null) {
    try { if (JSON.stringify(s.final_payload) !== JSON.stringify(buildSubmissionPayload(s, s.final_payload.submitted_at_client))) return false; }
    catch { return false; }
  }
  return true;
}
export function loadSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  let session;
  try { session = JSON.parse(raw); } catch { throw new SessionStateError('The saved study session is damaged.'); }
  if (!validateSession(session)) throw new SessionStateError('The saved session is incomplete or belongs to an earlier study version.');
  return session;
}
export function saveSession(session) {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    let previous; try { previous = JSON.parse(raw); } catch { throw new SessionStateError('The saved study session is damaged.'); }
    if (previous.session_id === session.session_id && previous.experiment_version === EXPERIMENT_VERSION) {
      if (previous.pre_locked && (!session.pre_locked || previous.pre_ai_judgement !== session.pre_ai_judgement || previous.condition !== session.condition || ['case','pre'].includes(session.step))) throw new Error('Your initial judgement is already locked. Please reload to resume.');
      if (previous.final_payload && JSON.stringify(previous.final_payload) !== JSON.stringify(session.final_payload)) throw new Error('The submission is already prepared. Please reload to retry the same response.');
    }
  }
  if (!validateSession(session)) throw new SessionStateError('The study session is incomplete or invalid.');
  localStorage.setItem(KEY, JSON.stringify(session));
}
export function isCompleted() { return localStorage.getItem('experiment_completed') === 'true'; }
export function completeSession(session) {
  // Keep the frozen payload for an idempotent retry: transport cannot confirm delivery.
  session.step = 'complete'; saveSession(session);
  localStorage.setItem('experiment_completed', 'true');
}
export function clearSession() { localStorage.removeItem(KEY); } // Never erase completion during recovery.
export function clearTestSession() { if (!TEST_MODE) throw new Error('Test mode is disabled'); clearSession(); localStorage.removeItem('experiment_completed'); }
