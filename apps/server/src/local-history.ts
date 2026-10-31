import { lstat,readFile,writeFile,rename,unlink,realpath } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../../../packages/shared-types/chat';
import { parseAttachments } from '../../../packages/shared-types/attachments';
export interface SavedConversation {owner:string;id:string;title:string;messages:ChatMessage[]}
export interface HistoryRepository {load(profile:string):Promise<SavedConversation[]>;save(profile:string,items:SavedConversation[]):Promise<void>}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export function validateHistory(profile:string,value:unknown):SavedConversation[]{
  if(!uuid(profile)||!Array.isArray(value)||value.length>100)throw new Error('로컬 대화 보관 형식 오류');
  const seen=new Set<string>();
  for(const c of value){
    if(!c||c.owner!==profile||!uuid(c.id)||seen.has(c.id)||typeof c.title!=='string'||c.title.length>200||!Array.isArray(c.messages)||c.messages.length>202)throw new Error('로컬 대화 소유자·형식 오류');seen.add(c.id);
    let characters=0;for(const m of c.messages){if(!m||!uuid(m.id)||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>32000||typeof m.model!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(m.model))throw new Error('로컬 메시지 형식 오류');characters+=m.text.length;if(m.attachments)parseAttachments(m.attachments);if(m.citations&&(!Array.isArray(m.citations)||m.citations.length>100))throw new Error('로컬 출처 형식 오류');}if(characters>132000)throw new Error('대화 길이 한도');
  }
  return value as SavedConversation[];
}
export class LocalHistory implements HistoryRepository{
  private queue=new Map<string,Promise<void>>();
  constructor(private directory:string){this.directory=resolve(directory);}
  private async file(profile:string){if(!uuid(profile))throw new Error('대화 프로필 오류');const d=await lstat(this.directory);if(!d.isDirectory()||d.isSymbolicLink()||(await realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase())throw new Error('대화 보관 폴더 오류');return join(this.directory,profile+'.json');}
  async load(profile:string){
    const path=await this.file(profile);try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>384*1024*1024)throw new Error('대화 보관 파일 오류');return validateHistory(profile,JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  }
  save(profile:string,items:SavedConversation[]){
    const content=JSON.stringify(validateHistory(profile,items));if(Buffer.byteLength(content)>384*1024*1024)throw new Error('대화 보관 용량 한도');
    const work=(this.queue.get(profile)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const path=await this.file(profile),temporary=path+'.'+randomUUID()+'.tmp';
      try{await writeFile(temporary,content,{flag:'wx',mode:0o600});await this.file(profile);await rename(temporary,path);}finally{await unlink(temporary).catch(()=>{});}
    });this.queue.set(profile,work);return work;
  }
}
