import { it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openai } from '../../src/openai';
import { REASONING_LEVELS } from '../../../../packages/shared-types/reasoning';
import { parseChat } from '../../../../packages/shared-types/chat';
import { parseTaskInput } from '../../../../packages/shared-types/task';
import { parseAgentRequest } from '../../../../packages/shared-types/agent';
const input={id:randomUUID(),text:'프로젝트를 검토하세요',model:'gpt-6.1-sol'};
const settings={openaiKey:'test-placeholder',models:[{id:input.model,label:'Sol'},{id:'gpt-6-astra',label:'Astra'}]};
const events=(text:string)=>new Response([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:10,output_tokens:20,total_tokens:30}}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
async function collect(source:AsyncIterable<unknown>){const items=[];for await(const item of source)items.push(item);return items;}
it.each(['gpt-6.1-sol','gpt-6-astra'])('sends every single-agent effort as a real Responses parameter for %s',async model=>{
  const bodies:any[]=[];const transport:typeof fetch=async(url,options)=>{if(String(url).includes('/models/'))return Response.json({id:model});bodies.push(JSON.parse(options!.body as string));return events('answer');};
  for(const level of REASONING_LEVELS.filter(l=>l.id!=='ultra'))await collect(openai(settings,transport).stream({...input,model,reasoningEffort:level.id},[],new AbortController().signal));
  expect(bodies.map(b=>b.reasoning.effort)).toEqual(['low','medium','high','xhigh','max']);expect(bodies.every(b=>b.model===model&&b.store===false)).toBe(true);expect(bodies.at(-1).max_output_tokens).toBeGreaterThan(bodies[0].max_output_tokens);
});
it.each(['gpt-6.1-sol','gpt-6-astra'])('Ultra really runs three concurrent reviewers and a final synthesis with %s',async model=>{
  const bodies:any[]=[],releases:(()=>void)[]=[];let active=0,maximum=0;
  const transport:typeof fetch=async(url,options)=>{
    if(String(url).includes('/models/'))return Response.json({id:model});const body=JSON.parse(options!.body as string);bodies.push(body);
    if(body.instructions.startsWith('병렬 검토자')){active++;maximum=Math.max(maximum,active);await new Promise<void>(r=>{releases.push(r);if(releases.length===3)releases.forEach(release=>release());});active--;return events('independent finding '+bodies.length);}
    expect(JSON.stringify(body.input)).toContain('independent finding');return events('final synthesis');
  };
  const result=await collect(openai(settings,transport).stream({...input,model,reasoningEffort:'ultra',webSearch:true},[],new AbortController().signal));
  expect(maximum).toBe(3);expect(bodies).toHaveLength(4);expect(bodies.every(b=>b.model===model&&b.reasoning.effort==='max')).toBe(true);
  expect(bodies.slice(0,3).every(b=>!b.tools&&!b.text)).toBe(true);expect(bodies[3].tools).toEqual([{type:'web_search'}]);
  expect(result).toEqual(['final synthesis',{usage:{input:40,output:80,total:120}}]);
});
it('cancels all parallel requests and never starts synthesis after cancellation',async()=>{
  const c=new AbortController();let started=0,aborted=0;
  const transport:typeof fetch=async(url,options)=>{if(String(url).includes('/models/'))return Response.json({id:input.model});started++;return new Promise((_,reject)=>{options!.signal!.addEventListener('abort',()=>{aborted++;reject(new Error('aborted'));},{once:true});});};
  const pending=collect(openai(settings,transport).stream({...input,reasoningEffort:'ultra'},[],c.signal)).catch(e=>e);
  await vi.waitFor(()=>expect(started).toBe(3));c.abort();expect(await pending).toBeInstanceOf(Error);expect(aborted).toBe(3);expect(started).toBe(3);
});
it('rejects unsupported levels and unknown model capabilities before contacting the provider',async()=>{
  for(const value of ['none','minimal','light','bogus',null]){
    expect(()=>parseChat({...input,reasoningEffort:value})).toThrow();expect(()=>parseTaskInput({prompt:'x',model:input.model,files:[],reasoningEffort:value})).toThrow();expect(()=>parseAgentRequest({action:'generate',id:input.id,mode:'edit',paths:['a.py'],prompt:'x',reasoningEffort:value})).toThrow();
  }
  const transport=vi.fn();await expect(collect(openai({openaiKey:'test-placeholder',models:[{id:'custom',label:'Unknown'}]},transport).stream({...input,model:'custom',reasoningEffort:'max'},[],new AbortController().signal))).rejects.toMatchObject({status:400});expect(transport).not.toHaveBeenCalled();
});
