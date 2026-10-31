import { expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { attachmentMime, parseAttachments, type ChatAttachment } from '../../../../packages/shared-types/attachments';
import { localAPI } from '../../src/local-api';
import { chatStore, history } from '../../src/chat-store';
import type oracledb from 'oracledb';
import { migrate } from '../../src/database/migrate';

function file(name:string,bytes:Buffer):ChatAttachment{return {id:randomUUID(),name,mime:attachmentMime(name),size:bytes.length,base64:bytes.toString('base64')};}
it('validates attachment bytes, filenames, MIME, base64, count and size before provider access',()=>{
  const a=file('notes.txt',Buffer.from('hello'));
  expect(parseAttachments([a])).toEqual([a]);
  for(const invalid of [{...a,mime:'image/png'},{...a,name:'.env.txt'},{...a,name:'../notes.txt'},{...a,name:'secret.txt'},{...a,base64:'!!!!!==='},{...a,size:11*1024*1024},{...a,path:'C:/private'},{...a,name:'a.png',mime:'image/png'}])expect(()=>parseAttachments([invalid])).toThrow();
  expect(()=>parseAttachments([a,a])).toThrow();
  expect(()=>parseAttachments(Array.from({length:5},()=>({...a,id:randomUUID()})))).toThrow();
});
it('stores and restores Oracle attachments with the completed user turn and enforces ownership first',async()=>{
  const attachment=file('notes.txt',Buffer.from('persistent notes'));
  const execute=vi.fn(async(sql:string,_binds?:unknown)=>({rows:sql.includes('SELECT COUNT(*)')?[{TOTAL:0}]:sql.includes('SELECT m.id')?[{ID:'message',ROLE:'user',CONTENT:'question',MODEL:'gpt-6.1-sol',CITATIONS:null,ATTACHMENTS:JSON.stringify([attachment])}]:[{ID:'owned',RUN_ID:'run'}]}));
  const connection={execute} as unknown as oracledb.Connection;
  const withUser=vi.fn(async(_credential:unknown,work:(c:oracledb.Connection,u:{id:string})=>unknown)=>work(connection,{id:'owner'}));
  const store=chatStore({withUser} as unknown as Parameters<typeof chatStore>[0]);
  const input={id:randomUUID(),text:'question',model:'gpt-6.1-sol',attachments:[attachment]};
  await store.finish(input,'run','answer','credential');
  const writes=execute.mock.calls.filter(([sql])=>sql.includes('INSERT INTO s3_attachments'));
  expect(writes).toHaveLength(1);expect((writes[0][1] as {content:{val:string}}).content.val).toBe(JSON.stringify([attachment]));
  expect((await history(connection,input.id))[0].attachments).toEqual([attachment]);
  execute.mockImplementation(async()=>({rows:[]}));execute.mockClear();
  await expect(store.finish(input,'run','answer','other')).rejects.toMatchObject({status:404});
  expect(execute.mock.calls).toHaveLength(1);
});
it('adds the attachment table when migrating schema 4 and skips an already current schema',async()=>{
  let version=4;
  const c={execute:vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT version')?[{VERSION:version}]:[]})),commit:vi.fn(),close:vi.fn()};
  const pool={getConnection:async()=>c} as unknown as oracledb.Pool;
  await migrate(pool);
  expect(c.execute.mock.calls.some(([sql])=>sql.includes('CREATE TABLE s3_attachments')&&sql.includes('ON DELETE CASCADE'))).toBe(true);
  expect(c.execute.mock.calls.some(([sql])=>sql.includes('version = 5'))).toBe(true);
  expect(c.commit).toHaveBeenCalledTimes(1);
  version=5;c.execute.mockClear();c.commit.mockClear();await migrate(pool);expect(c.execute).toHaveBeenCalledTimes(1);expect(c.commit).not.toHaveBeenCalled();
});
it('forwards image, PDF, office and text content to Responses and replays only the owning conversation attachments',async()=>{
  const bodies:any[]=[];
  const transport:typeof fetch=async(url,options)=>{
    if(String(url).includes('/models/'))return Response.json({id:'gpt-6.1-sol'});
    bodies.push(JSON.parse(options!.body as string));
    return new Response([{type:'response.output_text.delta',delta:'answer'},{type:'response.completed',response:{status:'completed',output:[]}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
  };
  let key='test-placeholder';
  const pairing=randomBytes(32).toString('base64url');
  const server=localAPI(pairing,()=>({openaiKey:key,models:[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol'}]}),transport);
  const session=async()=> (await server.inject({method:'POST',url:'/api/local/session',headers:{authorization:'Bearer '+pairing},payload:{profile:randomUUID()}})).json().data.credential;
  try {
    const token=await session(),other=await session(),headers={authorization:'Bearer '+token};
    const action=async(payload:unknown,auth=headers)=>server.inject({method:'POST',url:'/api/action',headers:auth,payload:payload as never});
    const id=(await action({action:'createConversation',title:'attachments'})).json().data.id;
    const attachments=[file('photo.png',Buffer.from('89504e470d0a1a0a','hex')),file('report.pdf',Buffer.from('%PDF-1.7\n')),file('report.docx',Buffer.from('504b030400','hex')),file('notes.txt',Buffer.from('문서 내용'))];
    const send=(payload:unknown,auth=headers)=>server.inject({method:'POST',url:'/api/chat',headers:auth,payload:payload as never});
    key='';expect((await send({id,text:'',model:'gpt-6.1-sol',attachments})).statusCode).toBe(503);expect(bodies).toHaveLength(0);key='test-placeholder';
    expect((await send({id,text:'',model:'gpt-6.1-sol',attachments})).body).toContain('"type":"done"');
    expect(bodies[0]).toMatchObject({model:'gpt-6.1-sol',store:false});
    const parts=bodies[0].input.at(-1).content;
    expect(parts[1]).toMatchObject({type:'input_image',image_url:'data:image/png;base64,'+attachments[0].base64,detail:'auto'});
    expect(parts[2]).toMatchObject({type:'input_file',filename:'report.pdf',file_data:'data:application/pdf;base64,'+attachments[1].base64});
    expect(parts[3]).toMatchObject({type:'input_file',filename:'report.docx'});
    expect(parts[4].text).toContain('문서 내용');
    expect((await action({action:'messages',id})).json().data[0].attachments).toEqual(attachments);
    const privateHeaders={authorization:'Bearer '+other};
    expect((await action({action:'messages',id},privateHeaders)).statusCode).toBe(404);
    expect((await send({id,text:'read',model:'gpt-6.1-sol'},privateHeaders)).statusCode).toBe(404);expect(bodies).toHaveLength(1);
    expect((await send({id,text:'follow up',model:'gpt-6.1-sol'})).body).toContain('"type":"done"');
    expect(bodies[1].input.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='input_image'))).toBe(true);
    // A valid upload larger than Fastify's default limit must reach the provider.
    const large=file('large.txt',Buffer.alloc(2*1024*1024,65));
    expect((await send({id,text:'large',model:'gpt-6.1-sol',attachments:[large]})).body).toContain('"type":"done"');
    for(const ext of ['xlsx','pptx'])expect((await send({id,text:'office',model:'gpt-6.1-sol',attachments:[file('report.'+ext,Buffer.from('504b030400','hex'))]})).body).toContain('"type":"done"');
  } finally {await server.close();}
});
