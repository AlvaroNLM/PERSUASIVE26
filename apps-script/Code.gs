// Paste into the script bound to your private Google Sheet, then run setup() once.
// This receiver validates and stores final data only. The model runs in the browser.
const SHEET_NAME = 'experiment_responses';
const HEADERS = [
  'server_received_at', 'submission_id', 'participant_id', 'session_id', 'created_at', 'submitted_at_client',
  'condition', 'experiment_version', 'case_version', 'classifier_version',
  'pre_ai_judgement', 'post_ai_judgement', 'classification', 'duration_seconds',
  'feature_attention', 'feature_distractibility', 'feature_impulsivity', 'feature_changes',
  'feature_social_communication', 'feature_repetitive_behaviours',
  'a1', 'a2', 'a3', 'a4', 't1', 't2', 'tr1', 'tr2', 'rp1', 'rp2', 'rp3', 'u1', 'mc1',
  'explanation_factors_json', 'test_mode'
];
const RATING_KEYS = ['a1','a2','a3','a4','t1','t2','tr1','tr2','rp1','rp2','rp3','u1','mc1'];
const FEATURE_COLUMNS = ['feature_attention','feature_distractibility','feature_impulsivity','feature_changes','feature_social_communication','feature_repetitive_behaviours'];
const FEATURE_NAMES = ['difficulty_sustaining_attention','distractibility','impulsive_responding','difficulty_with_changes','social_communication_difficulty','repetitive_behaviours'];

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from Extensions > Apps Script in your Google Sheet.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
    if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }
    checkHeaders_(sheet);
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  } finally { lock.releaseLock(); }
}

function validatePayload(payload) {
  const valid = (ok) => { if (!ok) throw new Error('invalid_payload'); };
  const integer = value => Number.isInteger(value) && value >= 1 && value <= 7;
  valid(payload && typeof payload === 'object' && !Array.isArray(payload));
  const fields = HEADERS.slice(1);
  valid(Object.keys(payload).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(payload,key)));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  ['submission_id','participant_id','session_id'].forEach(key => valid(typeof payload[key] === 'string' && uuid.test(payload[key])));
  valid(['XAI','NO_XAI'].includes(payload.condition));
  valid(payload.experiment_version === '2.0.0' && payload.case_version === 'alex_v1');
  valid(typeof payload.classifier_version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(payload.classifier_version));
  valid(['ADHD_RELATED','ASD_RELATED','INCONCLUSIVE'].includes(payload.classification));
  valid(typeof payload.test_mode === 'boolean');
  ['created_at','submitted_at_client'].forEach(key => {
    valid(typeof payload[key] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload[key]));
    const parsed = Date.parse(payload[key]);
    valid(Number.isFinite(parsed) && new Date(parsed).toISOString() === payload[key]);
  });
  const duration = Math.floor((Date.parse(payload.submitted_at_client) - Date.parse(payload.created_at)) / 1000);
  valid(Number.isSafeInteger(payload.duration_seconds) && payload.duration_seconds >= 0 && payload.duration_seconds === duration);
  ['pre_ai_judgement','post_ai_judgement',...RATING_KEYS].forEach(key => valid(integer(payload[key])));
  // Validate the fixed stimulus, without running a classifier on the server.
  FEATURE_COLUMNS.forEach((key,i) => valid(payload[key] === [3,4,2,1,1,0][i]));
  valid(typeof payload.explanation_factors_json === 'string' && payload.explanation_factors_json.length <= 6000);
  let factors;
  try { factors = JSON.parse(payload.explanation_factors_json); } catch (_) { throw new Error('invalid_payload'); }
  valid(Array.isArray(factors) && factors.length <= 6);
  const seen = new Set();
  factors.forEach(factor => {
    valid(factor && typeof factor === 'object' && !Array.isArray(factor));
    valid(Object.keys(factor).length === 4 && ['feature','value','contribution','text'].every(key => Object.prototype.hasOwnProperty.call(factor,key)));
    const i = FEATURE_NAMES.indexOf(factor.feature);
    valid(i >= 0 && !seen.has(factor.feature)); seen.add(factor.feature);
    valid(factor.value === payload[FEATURE_COLUMNS[i]] && Number.isFinite(factor.contribution));
    valid(typeof factor.text === 'string' && factor.text.length > 0 && factor.text.length <= 300 && !/[\u0000-\u001f]/.test(factor.text));
  });
  // Normalize the only free text container as JSON (starts with [, never a sheet formula).
  return Object.assign({},payload,{explanation_factors_json:JSON.stringify(factors)});
}

function doPost(e) {
  const receivedAt = new Date().toISOString();
  let lock;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 16000) throw new Error('invalid_payload');
    let parsed;
    try { parsed = JSON.parse(e.postData.contents); } catch (_) { throw new Error('invalid_payload'); }
    const payload = validatePayload(parsed);
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('setup_required');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('busy_retry');
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('setup_required');
    checkHeaders_(sheet);
    // Check and append inside one script lock, including concurrent requests.
    const count = sheet.getLastRow();
    if (count > 1 && sheet.getRange(2, 2, count - 1, 1).createTextFinder(payload.submission_id).matchEntireCell(true).matchCase(false).useRegularExpression(false).findNext()) {
      return json_({ok:true, duplicate:true});
    }
    const row = HEADERS.map(key => key === 'server_received_at' ? receivedAt : payload[key]);
    sheet.appendRow(row);
    SpreadsheetApp.flush(); // Make the write visible before releasing the lock.
    return json_({ok:true, duplicate:false});
  } catch (error) {
    const code = ['invalid_payload','setup_required','header_mismatch','busy_retry'].includes(error.message) ? error.message : 'storage_error';
    console.error('Study submission rejected: ' + code); // No payload, identifiers or personal data in logs.
    return json_({ok:false,error:code});
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function checkHeaders_(sheet) {
  const headers = sheet.getRange(1,1,1,HEADERS.length).getValues()[0];
  if (!HEADERS.every((key,i) => headers[i] === key)) throw new Error('header_mismatch');
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
