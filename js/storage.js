import { EXPERIMENT_VERSION, CASE_VERSION, TEST_MODE } from './config.js';
import { CASE_FEATURES, FEATURE_KEYS } from './classifier.js';
import { isJudgement } from '../supabase/functions/_shared/protocol.js';
import { QUESTIONS } from './questionnaire.js';
const KEY = 'hci_experiment_v1'; // Stable key lets us detect earlier experiment versions.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class SessionStateError extends Error {}
export function checkStorage() {
  localStorage.setItem('hci_storage_check', '1');
  localStorage.removeItem('hci_storage_check');
}
export function validateSession(s) {
  if (!s || s.experiment_version !== EXPERIMENT_VERSION || s.case_version !== CASE_VERSION || s.test_mode !== TEST_MODE) return false;
  if (!['participant_id','session_id','token'].every(k => typeof s[k] === 'string' && UUID.test(s[k]))) return false;
  if (!['case','pre','assessment','post','questionnaire'].includes(s.step) || typeof s.registered !== 'boolean' || typeof s.pre_locked !== 'boolean') return false;
  if (!(s.condition === null || ['XAI','NO_XAI'].includes(s.condition))) return false;
  if (!s.features || FEATURE_KEYS.some(k => s.features[k] !== CASE_FEATURES[k])) return false;
  if (!s.answers || Array.isArray(s.answers) || typeof s.answers !== 'object' || Object.entries(s.answers).some(([k,v]) => !QUESTIONS.some(([id]) => id === k) || !isJudgement(v))) return false;
  if (![s.pre_ai_judgement,s.post_ai_judgement].every(v => v === null || isJudgement(v))) return false;
  if (s.pre_locked && (!isJudgement(s.pre_ai_judgement) || !s.condition)) return false;
  if (['assessment','post','questionnaire'].includes(s.step) && !s.pre_locked) return false;
  if (s.step === 'questionnaire' && !isJudgement(s.post_ai_judgement)) return false;
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
export function saveSession(session) { localStorage.setItem(KEY, JSON.stringify(session)); }
export function isCompleted() { return localStorage.getItem('experiment_completed') === 'true'; }
export function completeSession() { localStorage.setItem('experiment_completed', 'true'); localStorage.removeItem(KEY); }
export function clearSession() { localStorage.removeItem(KEY); } // Never erase completion during recovery.
export function clearTestSession() { if (!TEST_MODE) throw new Error('Test mode is disabled'); clearSession(); localStorage.removeItem('experiment_completed'); }
