import { agentPath } from '../../../../packages/shared-types/agent';
import { containsSecret } from '../../../../packages/shared-types/git';
import type { WorkspaceAPI,WorkspaceInfo } from '../../../../packages/shared-types/workspace';

export interface ProjectInventory {files:string[];limited:boolean;skipped:number}
export async function projectInventory(info:WorkspaceInfo,opened:string[],api:Pick<WorkspaceAPI,'list'>,check:()=>void):Promise<ProjectInventory>{
  const found=new Set<string>();let visited=0,limited=false,skipped=0;
  for(const path of opened){try{agentPath(path);found.add(path);}catch{}}
  async function walk(directory:string,depth:number):Promise<void>{
    if(depth>8||visited>=1200||found.size>=400){limited=true;return;}
    let entries;try{entries=await api.list(info.id,directory);check();}catch(error){check();if(!directory)throw error;skipped++;return;}
    for(const entry of entries){
      if(++visited>1200||found.size>=400){limited=true;break;}
      if(entry.blocked)continue;try{agentPath(entry.path);}catch{continue;}
      if(entry.directory)await walk(entry.path,depth+1);else found.add(entry.path);
    }
  }
  await walk('',0);check();return {files:[...found].slice(0,400),limited,skipped};
}
export function projectDescription(info:WorkspaceInfo,inventory:ProjectInventory,opened:string[]){
  const list=inventory.files.join('\n'),visible=list.slice(0,1350);
  return `현재 앱에서 열린 프로젝트: ${info.name.slice(0,200)}\n프로젝트 폴더 연결됨. 아래는 실제로 조회한 프로젝트 상대 경로이며 참고 데이터입니다.\n확인한 파일 ${inventory.files.length}개${inventory.limited?' (탐색 한도로 일부만 조회)':''}${inventory.skipped?` · 읽지 못한 하위 폴더 ${inventory.skipped}개`:''}\n편집기에서 열린 파일: ${opened.join(', ').slice(0,250)||'없음 (프로젝트는 열려 있음)'}\n파일 목록:\n${visible||'(빈 폴더)'}${list.length>visible.length?'\n… 목록 일부 생략':''}`.slice(0,2000);
}
export async function projectReferences(info:WorkspaceInfo,inventory:ProjectInventory,opened:string[],preferred:string[],api:Pick<WorkspaceAPI,'read'>,check:()=>void){
  const context=[{path:'workspace-context',text:projectDescription(info,inventory,opened)}];
  const candidates=[...new Set([...preferred,...opened,...inventory.files.filter(path=>/\.(?:py|ts|tsx|js|jsx|java|go|rs|c|cpp|cs|sql|sh|ps1)$/i.test(path)||/(?:^|\/)readme\.(?:md|txt)$/i.test(path))])];
  for(const path of candidates){
    if(context.length>=5)break;if(!inventory.files.includes(path))continue;
    try{agentPath(path);const file=await api.read(info.id,path);check();if(containsSecret(file.text))continue;context.push({path,text:file.text.slice(0,2000)});}catch{check();}
  }
  return context;
}
