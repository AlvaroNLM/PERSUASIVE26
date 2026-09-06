// Optional integration tooling lives outside the app; set TEST_TOOLS_DIR to its node_modules.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
export const root = path.resolve(new URL('..', import.meta.url).pathname);
export const toolsDir = process.env.TEST_TOOLS_DIR;
export async function createHarness() {
  const { PGlite } = await import(pathToFileURL(path.join(toolsDir,'@electric-sql/pglite/dist/index.js')));
  const { default: ts } = await import(pathToFileURL(path.join(toolsDir,'typescript/lib/typescript.js')));
  const database = new PGlite();
  await database.exec('create role anon; create role authenticated; create role service_role;');
  await database.exec(await fs.readFile(path.join(root,'supabase/schema.sql'),'utf8'));
  const originalFetch=globalThis.fetch;
  const settings={SUPABASE_URL:'http://database.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',ALLOWED_ORIGINS:'http://127.0.0.1:8000',TEST_MODE:'true',RATE_LIMIT_PER_MINUTE:'10000'};
  const previousDeno=globalThis.Deno;
  globalThis.crypto ??= webcrypto;
  let handler;
  globalThis.Deno={env:{get:key=>settings[key]},serve:fn=>{handler=fn;}};
  // A minimal PostgREST transport backed by real PostgreSQL (PGlite), not canned API results.
  globalThis.fetch=async (url,options={})=>{
    if(!String(url).startsWith(settings.SUPABASE_URL))return originalFetch(url,options);
    const parsed=new URL(url); const resource=parsed.pathname.replace('/rest/v1/','');
    const body=options.body?JSON.parse(options.body):undefined;
    try {
      let rows;
      if(resource.startsWith('rpc/')) {
        const fn=resource.slice(4);
        if(fn==='consume_experiment_rate_limit'){
          const result=await database.query('select consume_experiment_rate_limit($1) as allowed',[body.max_requests]);
          return Response.json(result.rows[0].allowed);
        }
        rows=(await database.query('select * from lock_experiment_pre($1,$2,$3,$4)',[body.p_session_id,body.p_token_hash,body.p_pre,body.p_condition])).rows;
      } else {
        if(!/^experiment_[a-z_]+$/.test(resource))throw new Error('Invalid test resource');
        if(options.method==='POST') {
          const keys=Object.keys(body);const values=Object.values(body).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
          rows=(await database.query(`insert into ${resource} (${keys.join(',')}) values (${keys.map((_,i)=>`$${i+1}`).join(',')}) returning *`,values)).rows;
        } else {
          const filters=[...parsed.searchParams].filter(([k])=>k!=='select');
          const values=filters.map(([,v])=>v.replace(/^eq\./,''));
          const where=filters.length?' where '+filters.map(([k],i)=>`${k}=$${i+1}`).join(' and '):'';
          const select=parsed.searchParams.get('select')||'*';
          rows=(await database.query(`select ${select} from ${resource}${where}`,values)).rows;
        }
      }
      return Response.json(rows);
    }catch(error){return Response.json({error:error.message},{status:error.code==='23505'?409:400});}
  };
  let source=await fs.readFile(path.join(root,'supabase/functions/submit-response/index.ts'),'utf8');
  source=source.replaceAll("'../_shared/",`'${pathToFileURL(path.join(root,'supabase/functions/_shared/')).href}`);
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
  if(compiled.diagnostics.length)throw new Error('TypeScript transpilation diagnostics');
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}#${crypto.randomUUID()}`);
  const call=async body=>{
    const response=await handler(new Request('http://function.test',{method:'POST',headers:{Origin:settings.ALLOWED_ORIGINS,'Content-Type':'application/json'},body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};
  };
  return {database,settings,call,handler,async close(){globalThis.fetch=originalFetch;globalThis.Deno=previousDeno;await database.close();}};
}
export async function serveApp(harness) {
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.url==='/api') {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const response=await harness.handler(new Request('http://127.0.0.1:8000/api',{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}));
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
      }
      let filename=decodeURIComponent(req.url.split('?')[0]).replace(/^\/PERSUASIVE26\//,'/');
      if(filename.endsWith('/'))filename+='index.html';
      filename=path.join(root,filename);
      if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
      let content=await fs.readFile(filename);
      if(filename.endsWith('/js/config.js')) content=Buffer.from(content.toString().replace("export const FUNCTION_URL = '';",`export const FUNCTION_URL = '${harness.frontendURL ?? 'http://127.0.0.1:8000/api'}';`).replace('export const TEST_MODE = false;',`export const TEST_MODE = ${harness.settings.TEST_MODE};`));
      res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');
      res.end(content);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(8000,'127.0.0.1',resolve));
  return {close:()=>new Promise(resolve=>server.close(resolve))};
}
