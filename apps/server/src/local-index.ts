import { readFile, writeFile, mkdir, lstat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'dotenv';
import { localAPI, type LocalAPISettings } from './local-api';
import { chatModels } from './models';
import { LocalHistory } from './local-history';

async function main(){
  const environment=resolve(process.env.LOCAL_AI_ENV_FILE||'.env');
  const connection=resolve(process.env.LOCAL_AI_CONNECTION_FILE||'../../.tools/local-ai-server.json');
  const pairing=randomBytes(32).toString('base64url');
  const settings:LocalAPISettings={openaiKey:'',models:chatModels({})};
  const reload=async()=>{
    const stat=await lstat(environment);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Invalid server environment');
    const env=parse(await readFile(environment));const models=chatModels(env);
    settings.openaiKey=env.OPENAI_API_KEY?.trim()||'';settings.models=models;
  };
  await reload();
  const historyDirectory=process.env.LOCAL_AI_HISTORY_DIR?resolve(process.env.LOCAL_AI_HISTORY_DIR):undefined;
  if(historyDirectory){
    const dir=await lstat(historyDirectory);if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('Invalid history directory');
    if(process.platform==='win32'){
      const run=promisify(execFile),systemRoot=process.env.SystemRoot||'C:\\Windows';
      const identity=await run(resolve(systemRoot,'System32/whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true}),sid=identity.stdout.match(/S-1-(?:\d+-)+\d+/)?.[0];if(!sid)throw new Error('Windows identity unavailable');
      await run(resolve(systemRoot,'System32/icacls.exe'),[historyDirectory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)(F)`,'*S-1-5-18:(OI)(CI)(F)','*S-1-5-32-544:(OI)(CI)(F)'],{windowsHide:true});
    }
  }
  const server=localAPI(pairing,()=>structuredClone(settings),fetch,historyDirectory?new LocalHistory(historyDirectory):undefined);
  // Re-read only server-owned settings; no desktop process receives the API key.
  server.addHook('preHandler',async()=>{await reload();});
  await server.listen({host:'127.0.0.1',port:Number(process.env.LOCAL_AI_PORT||3002)});
  const address=server.server.address();if(!address||typeof address==='string')throw new Error('Local listener required');
  await mkdir(dirname(connection),{recursive:true});
  if(process.platform==='win32'){
    // mode:0600 alone does not set Windows ACLs. Restrict an empty file before
    // writing a pairing credential so other OS users cannot bootstrap sessions.
    await writeFile(connection,'',{mode:0o600});
    const run=promisify(execFile),systemRoot=process.env.SystemRoot||'C:\\Windows';
    const identity=await run(resolve(systemRoot,'System32/whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true});
    const sid=identity.stdout.match(/S-1-(?:\d+-)+\d+/)?.[0];if(!sid)throw new Error('Windows identity unavailable');
    await run(resolve(systemRoot,'System32/icacls.exe'),[connection,'/inheritance:r','/grant:r',`*${sid}:(F)`,'*S-1-5-18:(F)','*S-1-5-32-544:(F)'],{windowsHide:true});
  }
  await writeFile(connection,JSON.stringify({url:`http://127.0.0.1:${address.port}`,pairing,pid:process.pid}),{mode:0o600});
  console.info(JSON.stringify({event:'local_api_ready',port:address.port,database:false}));
  let closing=false;const shutdown=()=>{if(closing)return;closing=true;void server.close().then(async()=>{try{const v=JSON.parse(await readFile(connection,'utf8'));if(v.pairing===pairing)await unlink(connection);}catch{}});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
main().catch(()=>{console.error(JSON.stringify({event:'local_api_startup_failed'}));process.exitCode=1;});
