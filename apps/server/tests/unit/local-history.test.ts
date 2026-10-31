import { it,expect } from 'vitest';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalHistory,validateHistory } from '../../src/local-history';
import { localAPI } from '../../src/local-api';
it('restores conversation IDs and messages after server restart and keeps profile ownership',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'local-history-')),profile=randomUUID(),pair=randomBytes(32).toString('base64url');
  const config={openaiKey:'test-placeholder',models:[{id:'gpt-6.1-sol',label:'Sol'}]};
  const transport:typeof fetch=async url=>String(url).includes('/models/')?Response.json({id:'gpt-6.1-sol'}):new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'saved answer'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed'}})+'\n\n');
  let server=localAPI(pair,()=>config,transport,new LocalHistory(directory));
  const session=async(owner:string)=>{const r=await server.inject({method:'POST',url:'/api/local/session',headers:{authorization:'Bearer '+pair},payload:{profile:owner}});expect(r.statusCode).toBe(200);return r.json().data.credential;};
  const action=(token:string,payload:any)=>server.inject({method:'POST',url:'/api/action',headers:{authorization:'Bearer '+token},payload});
  try{
    const token=await session(profile),id=(await action(token,{action:'createConversation',title:'preserved'})).json().data.id;
    const response=await server.inject({method:'POST',url:'/api/chat',headers:{authorization:'Bearer '+token},payload:{id,text:'question',model:'gpt-6.1-sol',reasoningEffort:'high'}});expect(response.body).toContain('"type":"done"');
    await server.close();server=localAPI(pair,()=>config,transport,new LocalHistory(directory));const next=await session(profile);
    expect((await action(next,{action:'conversations'})).json().data).toEqual([{id,title:'preserved'}]);expect((await action(next,{action:'messages',id})).json().data.map((m:any)=>m.text)).toEqual(['question','saved answer']);
    const other=await session(randomUUID());expect((await action(other,{action:'messages',id})).statusCode).toBe(404);
    await action(next,{action:'deleteConversation',id});expect(JSON.parse(await readFile(join(directory,profile+'.json'),'utf8'))).toEqual([]);
  }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
it('rejects cross-profile snapshots and preserves existing data on invalid saves',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'history-boundary-')),profile=randomUUID(),history=new LocalHistory(directory);
  const saved=[{owner:profile,id:randomUUID(),title:'safe',messages:[]}];
  try{await history.save(profile,saved);expect(()=>validateHistory(randomUUID(),saved)).toThrow();expect(()=>history.save('../outside',[])).toThrow();expect(()=>history.save(profile,[{...saved[0],owner:randomUUID()}])).toThrow();expect(await history.load(profile)).toEqual(saved);}finally{await rm(directory,{recursive:true,force:true});}
});
