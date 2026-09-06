import { EXPERIMENT_VERSION, CASE_VERSION, isJudgement } from '../_shared/protocol.js';
import { CASE_FEATURES, FEATURE_KEYS, classifyProfile, CLASSIFIER_VERSION } from '../_shared/classifier.js';
const env = (name: string) => Deno.env.get(name) || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ratingKeys = 'a1 a2 a3 a4 t1 t2 tr1 tr2 rp1 rp2 rp3 u1 mc1'.split(' ');
const columns = 'attention distractibility impulsivity changes social_communication repetitive_behaviours'.split(' ');
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function requireValid(ok: unknown, message = 'Invalid request'): asserts ok { if (!ok) throw new HttpError(400, message); }
async function hash(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,'0')).join(''); }
async function db(path: string, method = 'GET', body?: unknown) {
 const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {method, headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'), Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type':'application/json', Prefer:'return=representation'}, body:body === undefined ? undefined : JSON.stringify(body)});
 if (!response.ok) { if(response.status === 409) throw new HttpError(409,'This session or participant has already been registered.'); throw new HttpError(503,'The study service is temporarily unavailable. Please try again.'); }
 return response.status === 204 ? null : response.json();
}
// Body is bounded while streaming, including requests without Content-Length.
async function readBody(request: Request) {
 const reader = request.body?.getReader(); requireValid(reader);
 let size = 0; const chunks: Uint8Array[]=[];
 while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>12000){await reader.cancel();throw new HttpError(413,'Request too large');} chunks.push(value); }
 const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid JSON');}
}
Deno.serve(async request => {
 const origin=request.headers.get('origin') || '';
 const allowed=env('ALLOWED_ORIGINS').split(',').map(s=>s.trim()).filter(Boolean);
 const cors: Record<string,string>={'Vary':'Origin','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(status:number, body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
 if(!origin || !allowed.includes(origin)) return reply(403,{error:'Origin not allowed'});
 cors['Access-Control-Allow-Origin']=origin; cors['Access-Control-Allow-Methods']='POST, OPTIONS'; cors['Access-Control-Allow-Headers']='Content-Type';
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST') return reply(405,{error:'Method not allowed'});
 try {
  if(!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) throw new HttpError(503,'Study backend is not configured.');
  requireValid(request.headers.get('content-type')?.split(';')[0]==='application/json','Expected application/json');
  const limit=Number(env('RATE_LIMIT_PER_MINUTE') || '120');
  if(!Number.isInteger(limit)||limit<1) throw new HttpError(503,'Invalid study configuration.');
  if(!await db('rpc/consume_experiment_rate_limit','POST',{max_requests:limit})) throw new HttpError(429,'The study is busy. Please wait a minute and try again.');
  const data=await readBody(request);
  requireValid(data && typeof data==='object' && !Array.isArray(data));
  const ipEnabled=env('STORE_IP_HASH')==='true';
  if(ipEnabled && (env('IP_HASH_SALT').length<32 || !env('TRUSTED_IP_HEADER'))) throw new HttpError(503,'Privacy settings are not configured.');
  if(data.action==='config') return reply(200,{ipHashEnabled:ipEnabled});
  requireValid(['start','resume','pre','submit'].includes(data.action));
  const base=['action','participant_id','session_id','token','experiment_version','case_version'];
  const keys=data.action==='start' ? [...base,'test_mode'] : data.action==='resume' ? base : data.action==='pre' ? [...base,'condition','pre_ai_judgement'] : [...base,'condition','features','answers','classifier_version','pre_ai_judgement','post_ai_judgement'];
  requireValid(Object.keys(data).every(k=>keys.includes(k)), 'Unexpected fields');
  for(const key of ['participant_id','session_id','token']) requireValid(typeof data[key]==='string' && UUID.test(data[key]));
  if(['pre','submit'].includes(data.action)) requireValid(['XAI','NO_XAI'].includes(data.condition));
  requireValid(data.experiment_version===EXPERIMENT_VERSION && data.case_version===CASE_VERSION);
  const tokenHash=await hash(data.token);
  let sessions=await db(`experiment_sessions?session_id=eq.${data.session_id}&select=*`);
  if(data.action==='start') {
   requireValid(typeof data.test_mode==='boolean' && data.test_mode===(env('TEST_MODE')==='true'), 'Study mode does not match the server.');
   if(!sessions.length) {
    try {sessions=await db('experiment_sessions','POST',{session_id:data.session_id,participant_id:data.participant_id,condition:null,token_hash:tokenHash,test_mode:data.test_mode,experiment_version:EXPERIMENT_VERSION,case_version:CASE_VERSION});}
    catch(err) {if(!(err instanceof HttpError)||err.status!==409)throw err;sessions=await db(`experiment_sessions?session_id=eq.${data.session_id}&select=*`);}
   }
  }
  const session=sessions[0];
  if(!session || session.token_hash!==tokenHash || session.participant_id!==data.participant_id || session.experiment_version!==EXPERIMENT_VERSION || session.case_version!==CASE_VERSION) throw new HttpError(403,'Session could not be verified.');
  if(data.action==='start') return reply(200,{ok:true,ipHashEnabled:ipEnabled});
  if(data.action==='resume') {
   const saved=await db(`experiment_responses?session_id=eq.${data.session_id}&select=id`);
   return reply(200,{pre_ai_judgement:session.pre_ai_judgement,condition:session.condition,completed:saved.length>0});
  }
  if(data.action==='pre') {
   requireValid(isJudgement(data.pre_ai_judgement),'Initial judgement must be an integer between 1 and 7.');
   const locked=await db('rpc/lock_experiment_pre','POST',{p_session_id:session.session_id,p_token_hash:tokenHash,p_pre:data.pre_ai_judgement,p_condition:data.condition});
   if(!locked[0] || !isJudgement(locked[0].pre_ai_judgement)) throw new HttpError(409,'Unable to lock initial judgement.');
   return reply(200,locked[0]);
  }
  requireValid(isJudgement(data.pre_ai_judgement) && isJudgement(data.post_ai_judgement),'Judgements must be integers between 1 and 7.');
  requireValid(session.pre_ai_judgement===data.pre_ai_judgement && session.condition===data.condition,'Initial judgement and assignment cannot change.');
  requireValid(data.classifier_version===CLASSIFIER_VERSION);
  requireValid(data.features && typeof data.features==='object' && Object.keys(data.features).length===6 && FEATURE_KEYS.every((k:string)=> data.features[k]===CASE_FEATURES[k]), 'Responses must match the fictional profile.');
  requireValid(data.answers && typeof data.answers==='object' && Object.keys(data.answers).length===13 && ratingKeys.every(k=>Number.isInteger(data.answers[k]) && data.answers[k]>=1 && data.answers[k]<=7),'All ratings must be integers between 1 and 7.');
  const existing=await db(`experiment_responses?session_id=eq.${data.session_id}&select=id`);
  if(existing.length) return reply(200,{ok:true}); // Idempotent retry after a lost response.
  let ipHash: string|null=null;
  if(ipEnabled) {
   // Only configure a header that your trusted gateway overwrites. Never log it.
   let ip=request.headers.get(env('TRUSTED_IP_HEADER'))?.trim() || '';
   if(!ip || ip.includes(',') || ip.length>64 || !/^[0-9a-fA-F:.]+$/.test(ip)) throw new HttpError(503,'Unable to apply configured privacy settings.');
   ipHash=await hash(ip+env('IP_HASH_SALT')); ip='';
   if(env('BLOCK_DUPLICATE_IP_HASH')==='true') {
    try {await db('experiment_ip_claims','POST',{ip_hash:ipHash,session_id:data.session_id});}
    catch(err){if(!(err instanceof HttpError)||err.status!==409)throw err;const claims=await db(`experiment_ip_claims?ip_hash=eq.${ipHash}&select=session_id`);if(claims[0]?.session_id!==data.session_id)throw new HttpError(409,'A response has already been recorded for this connection.');}
   }
  }
  const result=classifyProfile(data.features);
  const row:Record<string,unknown>={participant_id:session.participant_id,session_id:session.session_id,condition:session.condition,created_at:session.created_at,classification:result.classification,explanation_factors:result.explanationFactors,duration_seconds:Math.max(0,Math.floor((Date.now()-Date.parse(session.created_at))/1000)),ip_hash:ipHash,experiment_version:EXPERIMENT_VERSION,case_version:CASE_VERSION,pre_ai_judgement:session.pre_ai_judgement,post_ai_judgement:data.post_ai_judgement,classifier_version:CLASSIFIER_VERSION,test_mode:session.test_mode};
  FEATURE_KEYS.forEach((k:string,i:number)=>row[`case_${columns[i]}`]=data.features[k]);
  ratingKeys.forEach(k=>row[k]=data.answers[k]);
  try{await db('experiment_responses','POST',row);}catch(err){if(!(err instanceof HttpError)||err.status!==409)throw err;const saved=await db(`experiment_responses?session_id=eq.${data.session_id}&select=id`);if(!saved.length)throw err;}
  return reply(200,{ok:true});
 }catch(err){return reply(err instanceof HttpError?err.status:500,{error:err instanceof HttpError?err.message:'Unable to process your response. Please try again.'});}
});
