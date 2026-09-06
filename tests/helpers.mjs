// Test-only service doubles: production is static files plus the Google Web App.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
export const root = fileURLToPath(new URL('..',import.meta.url));
export const toolsDir = process.env.TEST_TOOLS_DIR;
export function createHarness({setup=true}={}) {
  const rows=[],events=[],logs=[];
  const state={held:false,busy:false,failWrite:false,columns:26};
  const properties=new Map();
  const lock={
    tryLock(){events.push('lock');if(state.busy)return false;state.held=true;return true;},
    waitLock(){if(!this.tryLock())throw new Error('busy_retry');},
    hasLock(){return state.held;},releaseLock(){events.push('release');state.held=false;}
  };
  const sheet={
    getLastRow:()=>rows.length,getMaxColumns:()=>state.columns,
    insertColumnsAfter:(_,count)=>{state.columns+=count;},setFrozenRows:()=>{},
    appendRow(row){if(!state.held)throw new Error('Write outside lock');if(state.failWrite)throw new Error('Simulated Sheets write error');events.push('append');rows.push([...row]);},
    getRange(row,column,height,width){return {
      getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>rows[row-1+r]?.[column-1+c]??'')),
      createTextFinder(text){return {matchEntireCell(){return this;},matchCase(){return this;},useRegularExpression(){return this;},findNext(){events.push('find');if(!state.held)throw new Error('Duplicate check outside lock');return rows.slice(row-1,row-1+height).some(r=>String(r[column-1]).toLowerCase()===text.toLowerCase())?{}:null;}}}
    };}
  };
  const spreadsheet={getSheetByName:()=>sheet,insertSheet:()=>sheet,getId:()=>'private-test-sheet'};
  const context=vm.createContext({
    console:{error:message=>logs.push(message)},
    SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet,openById:()=>spreadsheet,flush:()=>events.push('flush')},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})},
    LockService:{getScriptLock:()=>lock},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8'),context);
  if(setup)context.setup();
  return {context,rows,events,logs,state,headers:JSON.parse(vm.runInContext('JSON.stringify(HEADERS)',context)),call:payload=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(payload)}}).text),raw:body=>JSON.parse(context.doPost({postData:{contents:body}}).text)};
}
export async function serveApp() {
  // Use the same Python static server as local development, with a Pages subpath alias.
  const code=`import http.server,sys\nclass Handler(http.server.SimpleHTTPRequestHandler):\n def do_GET(self):\n  if self.path.startswith('/PERSUASIVE26/'):\n   self.path=self.path[len('/PERSUASIVE26'):]\n  super().do_GET()\n def log_message(self,*args): pass\nserver=http.server.ThreadingHTTPServer(('127.0.0.1',8000),Handler)\nprint('ready',flush=True)\nserver.serve_forever()`;
  const child=spawn('python3',['-u','-c',code],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>stderr+=data);
  await new Promise((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);child.once('exit',()=>reject(new Error(stderr||'Static server exited')));});
  return {close:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');})};
}
