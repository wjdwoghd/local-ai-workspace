import { afterEach, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { localAPI, type LocalAPISettings } from '../../src/local-api';
const servers:ReturnType<typeof localAPI>[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>s.close()));});
const stream=(text='real-provider-fixture',usage?:unknown)=>new Response([
  {type:'response.output_text.delta',delta:text},
  {type:'response.completed',response:{status:'completed',usage,output:[{content:[{annotations:[{type:'url_citation',url:'https://example.com',title:'source',start_index:0,end_index:4}]}]}]}}
].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
function fixture(){
  const pair=randomBytes(32).toString('base64url');const settings:LocalAPISettings={openaiKey:'test-placeholder-not-a-real-key',models:[{id:'gpt-6-astra',label:'Astra'}]};
  const transport=vi.fn<typeof fetch>(async(url)=>String(url).includes('/models/')?Response.json({id:settings.models[0].id}):stream());
  const server=localAPI(pair,()=>settings,transport);servers.push(server);
  const pairSession=async(profile=randomUUID())=>{const r=await server.inject({method:'POST',url:'/api/local/session',headers:{authorization:'Bearer '+pair},payload:{profile}});return r.json().data.credential as string;};
  const action=async(token:string,payload:unknown)=>server.inject({method:'POST',url:'/api/action',headers:{authorization:'Bearer '+token},payload:payload as never});
  return{server,pair,settings,transport,pairSession,action};
}
it('plans prompt-driven work with the selected model and rejects unlisted paths, missing keys, and unauthenticated requests',async()=>{
  const f=fixture(), token=await f.pairSession();
  const input={prompt:'a.ts의 값을 바꿔줘',model:'gpt-6-astra',files:['a.ts']};
  const plan={kind:'code',mode:'edit',query:'',paths:['a.ts']};
  const call=(auth=token)=>f.server.inject({method:'POST',url:'/api/plan',headers:{authorization:'Bearer '+auth},payload:input});
  expect((await call('')).statusCode).toBe(401);expect(f.transport).not.toHaveBeenCalled();
  f.settings.openaiKey='';expect((await call()).statusCode).toBe(503);expect(f.transport).not.toHaveBeenCalled();
  f.settings.openaiKey='test-placeholder';
  f.transport.mockImplementation(async url=>String(url).includes('/models/')?Response.json({id:input.model}):stream(JSON.stringify(plan)));
  expect((await call()).json()).toMatchObject({ok:true,data:plan});
  const body=JSON.parse(f.transport.mock.calls[1][1]!.body as string);
  expect(body).toMatchObject({model:input.model,store:false,text:{format:{name:'task_plan',strict:true}}});
  plan.paths=['not-selected.ts'];expect((await call()).statusCode).toBe(503);
  input.files=['.env'];expect((await call()).statusCode).toBe(400);
});
it('honors model selection for coding and lets ordinary chat choose web search automatically',async()=>{
  const f=fixture(), token=await f.pairSession();f.settings.models.push({id:'gpt-6.1-sol',label:'GPT-6.1 Sol'});
  f.transport.mockImplementation(async(url,options)=>String(url).includes('/models/')?Response.json({id:String(url).split('/').at(-1)}):stream(JSON.parse(options!.body as string).text?JSON.stringify({summary:'done',changes:[]}):'answer'));
  const code=await f.server.inject({method:'POST',url:'/api/code',headers:{authorization:'Bearer '+token},payload:{mode:'ask',prompt:'explain',model:'gpt-6.1-sol',files:[{path:'a.ts',text:'a',version:'a'.repeat(64)}]}});
  expect(code.json()).toMatchObject({ok:true,data:{model:'gpt-6.1-sol'}});
  const id=(await f.action(token,{action:'createConversation',title:'auto'})).json().data.id;
  const r=await f.server.inject({method:'POST',url:'/api/chat',headers:{authorization:'Bearer '+token},payload:{id,text:'latest news',model:'gpt-6-astra',autoTools:true,projectContext:[{path:'a.ts',text:'line 1: a'}]}});
  expect(r.body).toContain('"type":"sources"');
  const body=JSON.parse(f.transport.mock.calls.at(-1)![1]!.body as string);expect(body).toMatchObject({model:'gpt-6-astra',tool_choice:'auto',tools:[{type:'web_search'}]});
  expect(JSON.stringify(body.input)).toContain('line 1: a');
  expect((await f.server.inject({method:'POST',url:'/api/chat',headers:{authorization:'Bearer '+token},payload:{id,text:'test',model:'gpt-6-astra',projectContext:[{path:'.env',text:'secret'}]}})).statusCode).toBe(400);
});
it('requires local pairing/session authentication and rejects browser origins and forged profiles',async()=>{
  const f=fixture();
  expect((await f.server.inject({method:'POST',url:'/api/local/session',payload:{profile:randomUUID()}})).statusCode).toBe(401);
  expect((await f.server.inject({method:'POST',url:'/api/local/session',headers:{authorization:'Bearer '+f.pair,origin:'https://evil.example'},payload:{profile:randomUUID()}})).statusCode).toBe(403);
  expect((await f.server.inject({method:'POST',url:'/api/local/session',headers:{authorization:'Bearer '+f.pair},payload:{profile:'../other'}})).statusCode).toBe(400);
  expect((await f.action('',{action:'chatStatus'})).statusCode).toBe(401);expect(f.transport).not.toHaveBeenCalled();
});
it('distinguishes missing keys and inaccessible Astra, without fallback or sending conversation content',async()=>{
  const f=fixture(),token=await f.pairSession();f.settings.openaiKey='';
  expect((await f.action(token,{action:'chatStatus'})).json().data.configured).toBe(false);expect(f.transport).not.toHaveBeenCalled();
  f.settings.openaiKey='test-placeholder';f.transport.mockResolvedValue(new Response('private-upstream-error',{status:404}));
  const status=await f.action(token,{action:'chatStatus'});expect(status.json().data).toMatchObject({configured:false,models:[{id:'gpt-6-astra'}]});
  expect(status.body).not.toContain('private-upstream-error');expect(f.transport.mock.calls.every(c=>String(c[0]).endsWith('/models/gpt-6-astra'))).toBe(true);
});
it('isolates conversations and history across profiles and authenticates before provider access',async()=>{
  const f=fixture(),a=await f.pairSession(),b=await f.pairSession();const id=(await f.action(a,{action:'createConversation',title:'private'})).json().data.id;
  for(const action of ['messages','getConversation','deleteConversation'])expect((await f.action(b,{action,id})).statusCode).toBe(404);
  expect((await f.server.inject({method:'POST',url:'/api/chat',headers:{authorization:'Bearer '+b},payload:{id,text:'read it',model:'gpt-6-astra'}})).statusCode).toBe(404);
  expect(f.transport).not.toHaveBeenCalled();expect((await f.action(b,{action:'conversations'})).json().data).toEqual([]);
});
it('streams real provider frames, saves only completed turns and records only returned usage for the current profile',async()=>{
  const f=fixture(),a=await f.pairSession(),b=await f.pairSession(),id=(await f.action(a,{action:'createConversation',title:'chat'})).json().data.id;
  f.transport.mockImplementation(async(url)=>String(url).includes('/models/')?Response.json({id:'gpt-6-astra'}):stream('answer',{input_tokens:5,output_tokens:3,total_tokens:8}));
  const r=await f.server.inject({method:'POST',url:'/api/chat',headers:{authorization:'Bearer '+a},payload:{id,text:'question',model:'gpt-6-astra',webSearch:true}});
  expect(r.statusCode).toBe(200);expect(r.body).toContain('"type":"done"');expect(r.body).toContain('"type":"sources"');
  expect((await f.action(a,{action:'messages',id})).json().data.map((m:{text:string})=>m.text)).toEqual(['question','answer']);
  expect((await f.action(a,{action:'myUsage'})).json().data).toHaveLength(1);expect((await f.action(b,{action:'myUsage'})).json().data).toEqual([]);
  const sent=JSON.parse(f.transport.mock.calls[1][1]!.body as string);expect(sent).toMatchObject({model:'gpt-6-astra',store:false,tools:[{type:'web_search'}]});
  expect(r.body).not.toContain(f.settings.openaiKey);
});
it.each(['denied','truncated'])('preserves conversation on %s provider failure without saving partial messages',async(kind)=>{
  const f=fixture(),a=await f.pairSession(),id=(await f.action(a,{action:'createConversation',title:'chat'})).json().data.id;
  f.transport.mockImplementation(async(url)=>String(url).includes('/models/')?Response.json({id:'gpt-6-astra'}):kind==='denied'?new Response('secret-provider-detail',{status:429}):new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
  const r=await f.server.inject({method:'POST',url:'/api/chat',headers:{authorization:'Bearer '+a},payload:{id,text:'question',model:'gpt-6-astra'}});
  expect(r.body).toContain('"type":"error"');expect(r.body).not.toContain('secret-provider-detail');expect((await f.action(a,{action:'messages',id})).json().data).toEqual([]);
});
it('requests structured coding proposals and refuses unselected files and Ask edits without applying anything',async()=>{
  const f=fixture(),a=await f.pairSession();const input={mode:'edit',prompt:'improve',files:[{path:'a.ts',text:'const a=1;',version:'a'.repeat(64)}]};
  const code=async(output:unknown)=>{f.transport.mockImplementation(async(url)=>String(url).includes('/models/')?Response.json({id:'gpt-6-astra'}):stream(JSON.stringify(output)));return f.server.inject({method:'POST',url:'/api/code',headers:{authorization:'Bearer '+a},payload:input});};
  const r=await code({summary:'proposal',changes:[{path:'a.ts',after:'const a=2;'}]});expect(r.json()).toMatchObject({ok:true,data:{model:'gpt-6-astra',changes:[{path:'a.ts'}]}});
  const body=JSON.parse(f.transport.mock.calls[1][1]!.body as string);expect(body.text.format).toMatchObject({type:'json_schema',strict:true});
  expect((await code({summary:'bad',changes:[{path:'other.ts',after:'steal'}]})).statusCode).toBe(503);
  input.mode='ask';expect((await code({summary:'bad',changes:[{path:'a.ts',after:'edit'}]})).statusCode).toBe(503);
  input.files[0].path='.env';expect((await code({summary:'bad',changes:[]})).statusCode).toBe(400);
});
it('revokes sessions and denies unsupported team/admin actions rather than inventing a DB-backed service',async()=>{
  const f=fixture(),token=await f.pairSession();expect((await f.action(token,{action:'users'})).statusCode).toBe(503);
  await f.action(token,{action:'logout'});expect((await f.action(token,{action:'conversations'})).statusCode).toBe(401);
});
