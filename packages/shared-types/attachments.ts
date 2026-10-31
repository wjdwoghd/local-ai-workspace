export interface ChatAttachment { id:string; name:string; mime:string; size:number; base64:string }
export const ATTACHMENT_LIMITS={count:4,fileBytes:10*1024*1024,totalBytes:20*1024*1024,httpBytes:29*1024*1024};
export const ATTACHMENT_MIMES:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',md:'text/markdown',csv:'text/csv',tsv:'text/tab-separated-values',json:'application/json',js:'text/plain',ts:'text/plain',tsx:'text/plain',jsx:'text/plain',py:'text/plain',sql:'text/plain',html:'text/plain',css:'text/plain',yaml:'text/plain',yml:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
export const ATTACHMENT_ACCEPT=Object.keys(ATTACHMENT_MIMES).map(ext=>'.'+ext).join(',');
export function attachmentMime(name:string):string {
  if(!name||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name)||name.startsWith('.')||/(?:secret|credential|password|token)/i.test(name)||/^\.env(?:\.|$)/i.test(name))throw new Error('숨김·비밀 파일은 첨부할 수 없습니다.');
  const mime=ATTACHMENT_MIMES[name.split('.').at(-1)!.toLowerCase()];if(!mime)throw new Error('지원하지 않는 첨부 형식입니다.');return mime;
}
export function parseAttachments(raw:unknown):ChatAttachment[] {
  if(!Array.isArray(raw)||raw.length>ATTACHMENT_LIMITS.count)throw new Error('첨부는 한 번에 최대 4개입니다.');
  let total=0;const ids=new Set<string>();
  return raw.map(item=>{
    if(!item||typeof item!=='object'||Object.keys(item).sort().join(',')!=='base64,id,mime,name,size'||typeof item.id!=='string'||!/^[a-f0-9-]{36}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||typeof item.mime!=='string'||!Number.isInteger(item.size)||item.size<1||item.size>ATTACHMENT_LIMITS.fileBytes||typeof item.base64!=='string'||item.base64.length!==Math.ceil(item.size/3)*4||/[^A-Za-z0-9+/=]/.test(item.base64))throw new Error('첨부 파일 형식·크기를 확인하세요.');
    if(item.mime!==attachmentMime(item.name))throw new Error('첨부 파일 유형이 일치하지 않습니다.');
    const bytes=atob(item.base64);if(bytes.length!==item.size||btoa(bytes)!==item.base64)throw new Error('첨부 데이터가 손상되었습니다.');
    const ext=item.name.split('.').at(-1)!.toLowerCase();
    if((ext==='png'&&!bytes.startsWith('\x89PNG\r\n\x1a\n'))||(['jpg','jpeg'].includes(ext)&&!bytes.startsWith('\xff\xd8\xff'))||(ext==='webp'&&!(bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP'))||(ext==='pdf'&&!bytes.startsWith('%PDF-'))||(['docx','xlsx','pptx'].includes(ext)&&!bytes.startsWith('PK\x03\x04')))throw new Error('확장자와 실제 파일 내용이 일치하지 않습니다.');
    total+=item.size;if(total>ATTACHMENT_LIMITS.totalBytes)throw new Error('첨부 합계는 최대 20MB입니다.');ids.add(item.id);
    return {id:item.id,name:item.name,mime:item.mime,size:item.size,base64:item.base64};
  });
}
export function attachmentURL(file:ChatAttachment){return `data:${file.mime};base64,${file.base64}`;}
