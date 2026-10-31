import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMITS, attachmentMime, attachmentURL, parseAttachments, type ChatAttachment } from '../../../../packages/shared-types/attachments';
import { AppDialog } from './AppDialog';

export function useAttachments(onError:(message:string)=>void) {
  const [attachments,setAttachments]=useState<ChatAttachment[]>([]),[loading,setLoading]=useState(false);
  const current=useRef(attachments);current.current=attachments;
  const generation=useRef(0),pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  async function add(files:FileList|File[]) {
    if(pending.current||!files.length)return;
    pending.current=true;setLoading(true);const epoch=++generation.current;
    try {
      const selected=Array.from(files);
      if(current.current.length+selected.length>ATTACHMENT_LIMITS.count)throw new Error('첨부는 최대 4개입니다.');
      if(current.current.reduce((n,a)=>n+a.size,0)+selected.reduce((n,a)=>n+a.size,0)>ATTACHMENT_LIMITS.totalBytes)throw new Error('첨부 합계는 최대 20MB입니다.');
      const additions:ChatAttachment[]=[];
      for(const file of selected) {
        const mime=attachmentMime(file.name);if(!file.size||file.size>ATTACHMENT_LIMITS.fileBytes)throw new Error('파일당 최대 10MB까지 첨부할 수 있습니다.');
        const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('첨부 파일을 읽지 못했습니다.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
        additions.push({id:crypto.randomUUID(),name:file.name,mime,size:file.size,base64});
      }
      const next=parseAttachments([...current.current,...additions]);
      if(alive.current&&epoch===generation.current){current.current=next;setAttachments(next);}
    } catch(e){if(alive.current&&epoch===generation.current)onError((e as Error).message);}
    finally{pending.current=false;if(alive.current&&epoch===generation.current)setLoading(false);}
  }
  const clear=()=>{generation.current++;current.current=[];setAttachments([]);setLoading(false);};
  const remove=(id:string)=>{const next=current.current.filter(a=>a.id!==id);current.current=next;setAttachments(next);};
  const paste=(e:ClipboardEvent)=>{const files=Array.from(e.clipboardData.items).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((f):f is File=>!!f);if(files.length){e.preventDefault();void add(files);}};
  const drop=(e:DragEvent)=>{e.preventDefault();if(e.dataTransfer.files.length)void add(e.dataTransfer.files);};
  return {attachments,loading,add,clear,remove,paste,drop};
}
export function AttachmentList({files,remove,disabled=false}:{files:ChatAttachment[];remove?(id:string):void;disabled?:boolean}) {
  const [preview,setPreview]=useState<ChatAttachment>();
  if(!files.length)return null;
  return <><div className="chat-attachments" aria-label={remove?'첨부 대기 파일':'보낸 첨부 파일'}>{files.map(file=><div className="chat-attachment" key={file.id}>
    {file.mime.startsWith('image/')?<button type="button" className="attachment-thumbnail" aria-label={`${file.name} 미리보기`} onClick={()=>setPreview(file)}><img src={attachmentURL(file)} alt={file.name}/></button>:<span className="attachment-file-icon" aria-hidden="true">▤</span>}
    <div><strong title={file.name}>{file.name}</strong><small>{file.size<1024*1024?`${Math.ceil(file.size/1024)} KB`:`${(file.size/1024/1024).toFixed(1)} MB`}</small></div>
    {remove&&<button type="button" aria-label={`${file.name} 첨부 제거`} disabled={disabled} onClick={()=>remove(file.id)}>×</button>}
  </div>)}</div>{preview&&<AppDialog label={preview.name} onClose={()=>setPreview(undefined)}><img className="attachment-preview" src={attachmentURL(preview)} alt={preview.name}/></AppDialog>}</>;
}
export function AttachmentPicker({files,add,remove,disabled=false,loading=false}:{files:ChatAttachment[];add(files:FileList):Promise<void>;remove(id:string):void;disabled?:boolean;loading?:boolean}) {
  const input=useRef<HTMLInputElement>(null);
  return <div className="attachment-picker"><AttachmentList files={files} remove={remove} disabled={disabled||loading}/><input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" aria-label="파일 및 이미지 선택" disabled={disabled||loading} onChange={e=>{if(e.target.files)void add(e.target.files);e.target.value='';}}/>
    <button type="button" className="attach-button" disabled={disabled||loading||files.length>=ATTACHMENT_LIMITS.count} onClick={()=>input.current?.click()}>{loading?'첨부 읽는 중…':'＋ 파일·이미지 첨부'}</button>
    <small>최대 4개 · 파일당 10MB · 합계 20MB · 붙여넣기·드래그 가능. 보내면 선택한 모델에 전달됩니다.</small>
  </div>;
}
