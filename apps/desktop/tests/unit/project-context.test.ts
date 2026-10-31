import { describe,it,expect } from 'vitest';
import { projectInventory,projectDescription,projectReferences } from '../../src/renderer/project-context';
import type { WorkspaceEntry,WorkspaceFile } from '../../../../packages/shared-types/workspace';

const info={id:'project',name:'CryptoHack',root:'C:\\CryptoHack'};
const entry=(path:string,directory=false,blocked=false):WorkspaceEntry=>({path,name:path.split('/').at(-1)!,directory,blocked});
const file=(path:string,text:string):WorkspaceFile=>({path,text,version:'a'.repeat(64),bom:false,eol:'LF'});
describe('project context sent without opening an editor tab',()=>{
  it('discovers nested paths with spaces and excludes hidden, credential and blocked paths',async()=>{
    const api={list:async(_id:string,path:string)=>path?[entry('Modular Math/solve.py')]:[entry('Modular Math',true),entry('.env'),entry('credentials.json'),entry('escape.py',false,true)]};
    const inventory=await projectInventory(info,[],api,()=>{});
    expect(inventory.files).toEqual(['Modular Math/solve.py']);
    const context=await projectReferences(info,inventory,[],[],{read:async(_id,path)=>file(path,'def encrypt(): pass')},()=>{});
    expect(context[0].text).toContain('CryptoHack');expect(context[0].text).toContain('없음 (프로젝트는 열려 있음)');
    expect(context[1]).toEqual({path:'Modular Math/solve.py',text:'def encrypt(): pass'});
    expect(JSON.stringify(context)).not.toContain(info.root);
  });
  it('bounds metadata, snippets and inventory, skips secret contents and prioritizes open files',async()=>{
    const inventory=await projectInventory(info,['open.py'],{list:async()=>Array.from({length:500},(_,i)=>entry(`source-${i}.py`))},()=>{});
    expect(inventory.files).toHaveLength(400);expect(inventory.limited).toBe(true);
    expect(projectDescription({...info,name:'p'.repeat(500)},inventory,['a'.repeat(500)]).length).toBeLessThanOrEqual(2000);
    const context=await projectReferences(info,inventory,['open.py'],[],{read:async(_id,path)=>file(path,path==='source-0.py'?'api_key = "'+ 'A'.repeat(30)+'"':'x'.repeat(3000))},()=>{});
    expect(context).toHaveLength(5);expect(context[1].path).toBe('open.py');
    expect(context.some(c=>c.path==='source-0.py')).toBe(false);expect(context.every(c=>c.text.length<=2000)).toBe(true);
  });
  it('distinguishes an empty project from a missing or inaccessible project and honors cancellation',async()=>{
    const empty=await projectInventory(info,[],{list:async()=>[]},()=>{});
    expect(projectDescription(info,empty,[])).toContain('(빈 폴더)');
    await expect(projectInventory(info,[],{list:async()=>{throw new Error('root unavailable');}},()=>{})).rejects.toThrow('root unavailable');
    const partial=await projectInventory(info,[],{list:async(_id,path)=>{if(path)throw new Error('denied');return [entry('restricted',true),entry('main.py')];}},()=>{});
    expect(partial.skipped).toBe(1);expect(partial.files).toEqual(['main.py']);
    await expect(projectInventory(info,[],{list:async()=>[]},()=>{throw new Error('cancelled');})).rejects.toThrow('cancelled');
  });
});
