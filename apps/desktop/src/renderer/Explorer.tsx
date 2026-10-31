import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceEntry,WorkspaceInfo,WorkspacePaths,WorkspaceSearch } from '../../../../packages/shared-types/workspace';
import { relativeWorkspacePath } from '../../../../packages/shared-types/workspace';
import type { GitView } from '../../../../packages/shared-types/git';
import { FileIcon } from './FileIcon';
import { AppDialog } from './AppDialog';
import './explorer.css';

export type ExplorerMutation='file'|'directory'|'rename'|'trash';
export type ExplorerFocus={mode:'files'|'text';serial:number};
export function Explorer({info,tree,expanded,active,busy,dirty,hidden,git,focusRequest,onToggle,onOpen,onReveal,onRefresh,onMutate,onGit}:{
  info:WorkspaceInfo|null;tree:Record<string,WorkspaceEntry[]>;expanded:Set<string>;active:string;busy:boolean;dirty:boolean;hidden:boolean;git?:GitView;focusRequest?:ExplorerFocus;
  onToggle(path:string):void;onOpen(path:string):void;onReveal(path:string):void;onRefresh():void;onMutate(kind:ExplorerMutation,path:string,target?:string):Promise<void>;onGit(operation:'stage'|'unstage',paths:string[]):void;
}){
  const [selected,setSelected]=useState<WorkspaceEntry>(),[menu,setMenu]=useState<{entry:WorkspaceEntry;x:number;y:number}>();
  const [dialog,setDialog]=useState<{kind:ExplorerMutation;entry:WorkspaceEntry}>(),[name,setName]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const [mode,setMode]=useState<'files'|'text'>('files'),[query,setQuery]=useState(''),[paths,setPaths]=useState<WorkspacePaths>(),[text,setText]=useState<WorkspaceSearch>(),[searching,setSearching]=useState(false),[revision,setRevision]=useState(0);
  const input=useRef<HTMLInputElement>(null),request=useRef(0),live=useRef(true),mutation=useRef(false);
  useEffect(()=>{live.current=true;return()=>{live.current=false;request.current++;};},[]);
  const root:WorkspaceEntry={path:'',name:info?.name||'',directory:true,blocked:false};
  useEffect(()=>{if(focusRequest){setMode(focusRequest.mode);input.current?.focus();input.current?.select();}},[focusRequest?.serial]);
  useEffect(()=>{if(!info)return;let timer:ReturnType<typeof setTimeout>;const off=window.desktop.workspace.onEvent(e=>{if(e.id===info.id&&e.type==='change'){clearTimeout(timer);timer=setTimeout(()=>setRevision(n=>n+1),400);}});return()=>{clearTimeout(timer);off();};},[info?.id]);
  useEffect(()=>{
    const ticket=++request.current;setPaths(undefined);setText(undefined);setError('');
    if(!info||!query.trim()||hidden){setSearching(false);return;}
    setSearching(true);const timer=setTimeout(()=>{
      const operation=mode==='files'?window.desktop.workspace.findPaths(info.id,query):window.desktop.workspace.search(info.id,query);
      void operation.then(result=>{if(request.current!==ticket)return;if('matches'in result)setPaths(result);else setText(result);}).catch(e=>{if(request.current===ticket)setError(clean(e));}).finally(()=>{if(request.current===ticket)setSearching(false);});
    },200);
    return()=>{clearTimeout(timer);request.current++;};
  },[info?.id,query,mode,revision,hidden]);
  useEffect(()=>{if(!menu)return;const close=()=>setMenu(undefined),escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();close();}};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);window.addEventListener('blur',close);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape);window.removeEventListener('blur',close);};},[menu]);
  const clean=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
  const show=(entry:WorkspaceEntry,x:number,y:number)=>{setSelected(entry);setMenu({entry,x:Math.min(x,window.innerWidth-240),y:Math.min(y,window.innerHeight-350)});};
  const createIn=selected?.directory?selected:selected?{...root,path:selected.path.split('/').slice(0,-1).join('/')} : root;
  function edit(kind:ExplorerMutation,entry:WorkspaceEntry){setMenu(undefined);setError('');setName(kind==='rename'?entry.name:'');setDialog({kind,entry});}
  async function submit(){
    if(!dialog||mutation.current)return;mutation.current=true;setWorking(true);setError('');
    try{
      let target:string|undefined;
      if(dialog.kind!=='trash'){
        relativeWorkspacePath(name);if(name.includes('/'))throw new Error('파일 또는 폴더 이름 하나를 입력하세요.');
        const parent=dialog.kind==='rename'?dialog.entry.path.split('/').slice(0,-1).join('/'):dialog.entry.path;
        target=parent?parent+'/'+name:name;
      }
      await onMutate(dialog.kind,dialog.entry.path,target);
      if(live.current){setDialog(undefined);setSelected(undefined);setRevision(n=>n+1);}
    }catch(e){if(live.current)setError(clean(e));}finally{mutation.current=false;if(live.current)setWorking(false);}
  }
  function gitPaths(entry:WorkspaceEntry,operation:'stage'|'unstage'){
    return (git?.changes||[]).filter(c=>(entry.path===''||c.path===entry.path||entry.directory&&c.path.startsWith(entry.path+'/'))&&(operation==='unstage'?c.unstageAllowed:!c.blocked&&(c.worktree!==' '||c.index==='?'))).map(c=>c.path);
  }
  function rows(path:string):React.ReactNode{
    return <ul>{(Object.hasOwn(tree,path)?tree[path]:[]).map(entry=>{
      const change=git?.changes.find(c=>c.path===entry.path),status=change?(change.index==='?'?'U':change.worktree!==' '?change.worktree:change.index):'';
      return <li key={entry.path}><div className={'explorer-row'+(selected?.path===entry.path?' selected':'')} onContextMenu={e=>{e.preventDefault();e.stopPropagation();show(entry,e.clientX,e.clientY);}}>
        <button className="explorer-entry" disabled={entry.blocked||busy} title={entry.blocked?'링크 또는 지원하지 않는 경로입니다.':entry.path} aria-current={active===entry.path?'true':undefined} aria-expanded={entry.directory?expanded.has(entry.path):undefined} onClick={()=>{setSelected(entry);entry.directory?onToggle(entry.path):onOpen(entry.path);}} onKeyDown={e=>{
          if(e.key==='F2'){e.preventDefault();edit('rename',entry);}else if(e.key==='Delete'){e.preventDefault();edit('trash',entry);}else if(entry.directory&&((e.key==='ArrowRight'&&!expanded.has(entry.path))||(e.key==='ArrowLeft'&&expanded.has(entry.path)))){e.preventDefault();onToggle(entry.path);}
        }}>{entry.directory&&<span className="tree-chevron">{expanded.has(entry.path)?'⌄':'›'}</span>}<FileIcon name={entry.name} directory={entry.directory} open={expanded.has(entry.path)}/><span className="explorer-name">{entry.name}{entry.blocked?' (차단)':''}</span>{status&&<span aria-hidden="true" className={'explorer-git status-'+status} title={change?.unstageAllowed?'스테이징된 변경 포함':'작업 파일 변경'}>{status}</span>}</button>
        <button className="explorer-row-menu" disabled={entry.blocked||busy} aria-label={`${entry.path} 작업 메뉴`} title="파일·폴더 작업" onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();show(entry,rect.left,rect.bottom);}}>···</button>
      </div>{entry.directory&&expanded.has(entry.path)&&rows(entry.path)}</li>;
    })}</ul>;
  }
  const menuItems=menu&&<div role="menu" aria-label={`${menu.entry.path||'프로젝트'} 작업`} className="explorer-context" style={{left:Math.max(4,menu.x),top:Math.max(4,menu.y)}} onPointerDown={e=>e.stopPropagation()}>
    <small>{menu.entry.path||info?.name}</small>
    {!menu.entry.directory&&<button role="menuitem" disabled={busy||menu.entry.blocked} onClick={()=>{onOpen(menu.entry.path);setMenu(undefined);}}>편집기로 열기</button>}
    <button role="menuitem" disabled={busy||menu.entry.blocked} onClick={()=>edit('file',menu.entry.directory?menu.entry:{...root,path:menu.entry.path.split('/').slice(0,-1).join('/')})}>새 파일</button>
    <button role="menuitem" disabled={busy||menu.entry.blocked} onClick={()=>edit('directory',menu.entry.directory?menu.entry:{...root,path:menu.entry.path.split('/').slice(0,-1).join('/')})}>새 폴더</button>
    {!!menu.entry.path&&<><button role="menuitem" disabled={busy||dirty||menu.entry.blocked} onClick={()=>edit('rename',menu.entry)}>이름 변경 <kbd>F2</kbd></button><button role="menuitem" disabled={busy||dirty||menu.entry.blocked} onClick={()=>edit('trash',menu.entry)}>휴지통으로 이동 <kbd>Del</kbd></button></>}
    <hr/>{(['stage','unstage'] as const).map(operation=>{const files=gitPaths(menu.entry,operation);return <button key={operation} role="menuitem" disabled={busy||dirty||!files.length||files.length>100} onClick={()=>{onGit(operation,files);setMenu(undefined);}}>{operation==='stage'?'변경 스테이징 검토':'스테이징 해제 검토'}{files.length?` (${files.length})`:''}</button>;})}
    <hr/><button role="menuitem" onClick={()=>{void window.desktop.copyText(menu.entry.path).catch(e=>setError(clean(e)));setMenu(undefined);}}>상대 경로 복사</button><button role="menuitem" onClick={()=>{onRefresh();setMenu(undefined);}}>새로고침</button>
  </div>;
  return <aside className="file-tree" hidden={hidden} aria-label="파일 탐색기" onContextMenu={e=>{e.preventDefault();if(info)show(root,e.clientX,e.clientY);}}>
    {info?<><div className="explorer-toolbar"><strong title={info.root}>{info.name.toUpperCase()}</strong><button disabled={busy} aria-label="새 파일" title="새 파일" onClick={()=>edit('file',createIn)}><span className="codicon codicon-new-file"/></button><button disabled={busy} aria-label="새 폴더" title="새 폴더" onClick={()=>edit('directory',createIn)}><span className="codicon codicon-new-folder"/></button><button disabled={busy} aria-label="Explorer 새로고침" title="새로고침" onClick={onRefresh}><span className="codicon codicon-refresh"/></button></div>
    <div className="explorer-search"><input ref={input} aria-label={mode==='files'?'Explorer 파일 검색':'Explorer 내용 검색'} placeholder={mode==='files'?'파일 검색 (Ctrl+P)':'파일 내용 검색 (Ctrl+Shift+F)'} value={query} maxLength={256} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setQuery('');e.stopPropagation();}}}/><button aria-label={mode==='files'?'내용 검색으로 전환':'파일 이름 검색으로 전환'} title={mode==='files'?'내용 검색':'파일 이름 검색'} onClick={()=>setMode(mode==='files'?'text':'files')}>{mode==='files'?'Aa':'⌕'}</button>{query&&<button aria-label="Explorer 검색 지우기" onClick={()=>setQuery('')}>×</button>}</div>
    {query.trim()?<div className="explorer-results" aria-label="Explorer 검색 결과"><p role="status">{searching?'검색 중…':`${paths?.matches.length??text?.hits.length??0}개 결과${paths?.limited||text?.limited?' · 일부 결과':''}`}</p>{paths?.matches.map(entry=><button key={entry.path} title={entry.path} onClick={()=>{setQuery('');onReveal(entry.path);}}><FileIcon name={entry.name}/><span>{entry.name}<small>{entry.path}</small></span></button>)}{text?.hits.map((hit,i)=><button key={hit.path+':'+hit.line+':'+i} title={hit.path+':'+hit.line} onClick={()=>{setQuery('');onReveal(hit.path);}}><FileIcon name={hit.path}/><span>{hit.path}:{hit.line}<small>{hit.text}</small></span></button>)}</div>:rows('')}
    </>:<p>프로젝트 폴더를 선택하세요.<br/>파일과 터미널 출력은 자동 업로드되지 않습니다.</p>}
    {error&&!dialog&&<p role="alert">{error}</p>}{menu&&createPortal(menuItems,document.body)}
    {dialog&&createPortal(<AppDialog label={dialog.kind==='file'?'새 파일':dialog.kind==='directory'?'새 폴더':dialog.kind==='rename'?'이름 변경':'휴지통으로 이동'} onClose={()=>{if(!working){setDialog(undefined);setError('');}}}><form className="explorer-dialog" onSubmit={e=>{e.preventDefault();void submit();}}><h2>{dialog.kind==='file'?'새 파일':dialog.kind==='directory'?'새 폴더':dialog.kind==='rename'?'이름 변경':'휴지통으로 이동'}</h2><p>{dialog.entry.path||info?.name}</p>{dialog.kind==='trash'?<p>이 항목을 휴지통으로 이동할까요?</p>:<label>이름<input autoFocus aria-label="파일·폴더 이름" value={name} maxLength={255} disabled={working} onChange={e=>setName(e.target.value)}/></label>}{error&&<p role="alert">{error}</p>}<div><button type="button" disabled={working} onClick={()=>{setDialog(undefined);setError('');}}>취소</button><button disabled={working||(dialog.kind!=='trash'&&!name.trim())}>{working?'처리 중…':dialog.kind==='trash'?'휴지통으로 이동':dialog.kind==='rename'?'이름 변경':'만들기'}</button></div></form></AppDialog>,document.body)}
  </aside>;
}
