import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GitApproval, GitChange, GitCommit, GitCommitFiles, GitFileDiff, GitIntent, GitView } from '../../../../packages/shared-types/git';
import { AppDialog } from './AppDialog';
import { FileIcon } from './FileIcon';
import './git.css';

export type GitOpenRequest={kind:'branches'|'history'|'remote';serial:number;workspace?:string;fileOperation?:'stage'|'unstage';paths?:string[]};
const operationNames:Record<GitIntent['operation'],string>={stage:'스테이징',unstage:'스테이징 해제',commit:'커밋',push:'Push',pull:'Pull',pr:'Draft PR 만들기',checkout:'브랜치 전환','create-branch':'브랜치 만들기'};
const isConflict=(c:GitChange)=>c.index==='U'||c.worktree==='U'||['AA','DD'].includes(c.index+c.worktree);
function Patch({text}:{text:string}){return <pre className="git-patch">{text.split('\n').map((line,i)=><span key={i} className={line.startsWith('+')?'patch-add':line.startsWith('-')?'patch-remove':line.startsWith('@@')?'patch-hunk':''}>{line}{'\n'}</span>)}</pre>;}
function graph(commits:GitCommit[]){
  const lanes:(string|null)[]=[];
  return commits.map(commit=>{
    let lane=lanes.indexOf(commit.id);if(lane<0){lane=lanes.indexOf(null);if(lane<0)lane=lanes.length;lanes[lane]=commit.id;}
    const incoming=lanes.map((id,i)=>id&&i!==lane?i:-1).filter(i=>i>=0);lanes[lane]=null;
    const outgoing=commit.parents.map((parent,i)=>{let target=lanes.indexOf(parent);if(target<0){target=i===0&&lanes[lane]===null?lane:lanes.indexOf(null);if(target<0)target=lanes.length;lanes[target]=parent;}return target;});
    return {lane,incoming,outgoing,width:Math.max(lanes.length,1)*12+12};
  });
}
const graphColors=['#64b5ff','#d699ff','#6bd4a0','#efb960','#ee899d','#68d8dc'];
export function GitPanel({id,dirty,visible=true,onView,onDiff,openRequest,onNotice}:{id:string;dirty:boolean;visible?:boolean;onView?(view:GitView|undefined):void;onDiff?(diff:GitFileDiff|undefined):void;openRequest?:GitOpenRequest;onNotice?(message:string):void}){
  const [view,setView]=useState<GitView>(),[operationError,setError]=useState(''),[statusError,setStatusError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const error=operationError||statusError;
  const [commit,setCommit]=useState(''),[approval,setApproval]=useState<GitApproval>(),[dialog,setDialog]=useState<GitOpenRequest['kind']|'connection'|null>(null);
  const [branchQuery,setBranchQuery]=useState(''),[filter,setFilter]=useState(''),[selectedCommit,setSelectedCommit]=useState<GitCommit>(),[commitFiles,setCommitFiles]=useState<GitCommitFiles>();
  const [base,setBase]=useState('main'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[url,setURL]=useState('');
  const live=useRef(true),locked=useRef(false),refreshing=useRef(false),onViewRef=useRef(onView),selection=useRef(0);onViewRef.current=onView;
  const handledRequest=useRef<number>(undefined);
  const fail=(e:unknown)=>setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));
  async function refresh(connection=false){
    if(refreshing.current)return;refreshing.current=true;
    try{const next=await window.desktop.git({action:connection?'connection':'status',id}) as GitView;if(live.current){setView(next);onViewRef.current?.(next);setStatusError('');}}
    catch(e){if(live.current){setView(undefined);onViewRef.current?.(undefined);setStatusError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}}
    finally{refreshing.current=false;}
  }
  useEffect(()=>{live.current=true;onViewRef.current?.(undefined);void refresh();return()=>{live.current=false;selection.current++;};},[id]);
  useEffect(()=>{
    if(!visible)return;if(!locked.current)void refresh();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=setInterval(()=>{if(!locked.current)void refresh();},5000);
    const off=window.desktop.workspace.onEvent(event=>{if(event.id===id&&event.type==='change'){clearTimeout(timer);timer=setTimeout(()=>{if(!locked.current)void refresh();},700);}});
    const focus=()=>{if(!locked.current)void refresh();};window.addEventListener('focus',focus);
    return()=>{clearInterval(poll);clearTimeout(timer);off();window.removeEventListener('focus',focus);};
  },[id,visible]);
  useEffect(()=>{
    if(!openRequest||handledRequest.current===openRequest.serial||openRequest.workspace&&openRequest.workspace!==id)return;
    if(openRequest.fileOperation){if(locked.current)return;handledRequest.current=openRequest.serial;void work(async()=>{
      onNotice?.('Git 검토를 준비하고 있습니다…');
      try{await prepare(openRequest.fileOperation!,openRequest.paths||[]);if(live.current)onNotice?.('');}
      catch(e){if(live.current)onNotice?.((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));throw e;}
    });}
    else{handledRequest.current=openRequest.serial;setDialog(openRequest.kind);setBranchQuery('');}
  },[openRequest?.serial,busy]);
  async function work(task:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setError('');setMessage('');try{await task();}catch(e){if(live.current)fail(e);}finally{locked.current=false;if(live.current)setBusy(false);}}
  async function prepare(operation:GitIntent['operation'],files:string[]=[],target=base){const result=await window.desktop.git({action:'prepare',id,intent:{operation,files,message:commit,base:target,title,body}});if(live.current){setDialog(null);setApproval(result as GitApproval);}}
  async function diff(path:string,staged:boolean){const result=await window.desktop.git({action:'diff',id,path,staged});if(live.current&&'kind'in result&&result.kind==='file-diff')onDiff?.(result);}
  async function inspect(c:GitCommit){const revision=++selection.current;setSelectedCommit(c);setCommitFiles(undefined);try{const result=await window.desktop.git({action:'commit-files',id,commit:c.id});if(live.current&&revision===selection.current&&'kind'in result&&result.kind==='commit-files')setCommitFiles(result);}catch(e){if(live.current&&revision===selection.current)fail(e);}}
  const changes=view?.changes||[],conflicts=changes.filter(isConflict),staged=changes.filter(c=>c.unstageAllowed&&!isConflict(c)),unstaged=changes.filter(c=>(c.worktree!==' '||c.index==='?'||c.blocked&&!c.unstageAllowed)&&!isConflict(c));
  function group(label:string,items:GitChange[],index:boolean,conflict=false){
    const eligible=items.filter(c=>index?c.unstageAllowed:!c.blocked).map(c=>c.path);
    return <details className="git-group" open><summary><span>{label}</span><b>{items.length}</b><button type="button" aria-label={index?'모두 스테이징 해제 검토':`${label} 모두 스테이징 검토`} title={index?'모두 스테이징 해제':'모두 스테이징'} disabled={busy||dirty||!eligible.length} onClick={e=>{e.preventDefault();void work(()=>prepare(index?'unstage':'stage',eligible));}}>{index?'−':'＋'}</button></summary>
      {!items.length?<p className="git-empty">변경 없음</p>:items.map(c=>{const parts=c.path.split('/'),name=parts.pop()!,directory=parts.join('/'),status=conflict?'!':index?c.index:c.index==='?'?'U':c.worktree;
        return <div className="git-file-row" key={c.path} data-status={status}>
          <button type="button" className="git-file-name" aria-label={`${c.path} ${index?'스테이징':'작업 파일'} diff`} title={c.blocked?'보호되거나 지원하지 않는 파일':c.path} disabled={busy||c.blocked} onClick={()=>void work(()=>diff(c.path,index))}><FileIcon name={name}/><span>{name}<small>{directory}</small></span></button>
          <span className="git-file-status" title={c.blocked?'보호 파일':status==='U'?'추적하지 않은 파일':status==='M'?'수정':status==='A'?'추가':status==='D'?'삭제':'변경'}>{c.blocked?'⊘':status}</span>
          <button type="button" className="git-row-action" aria-label={`${c.path} ${index?'스테이징 해제':'스테이징'} 검토`} title={index?'스테이징 해제':'스테이징'} disabled={busy||dirty||(index?!c.unstageAllowed:c.blocked)} onClick={()=>void work(()=>prepare(index?'unstage':'stage',[c.path]))}>{index?'−':'＋'}</button>
        </div>;
      })}</details>;
  }
  const commits=(view?.history||[]).filter(c=>!filter||`${c.subject} ${c.author} ${c.id} ${c.refs.join(' ')}`.toLowerCase().includes(filter.toLowerCase())),graphs=graph(view?.history||[]),graphWidth=Math.min(160,Math.max(36,...graphs.map(g=>g.width)));
  return <section className="git-panel" aria-label="Git 소스 제어" aria-busy={busy}>
    <div className="git-repository"><span className="codicon codicon-source-control"/><strong title={view?.root}>{view?.root.split(/[\\/]/).pop()||'저장소'}</strong><button aria-label="Git 새로고침" title="Git 새로고침" disabled={busy} onClick={()=>void work(()=>refresh())}>↻</button><button aria-label="Git 원격 작업" title="Push · Pull · PR" onClick={()=>setDialog('remote')}>···</button></div>
    {view?<>
      <button className="git-branch-heading" title={`현재 브랜치: ${view.branch||'분리된 HEAD'}`} onClick={()=>setDialog('branches')}><span>⑂</span><strong>{view.branch||view.head.slice(0,7)||'첫 커밋 전'}</strong><span>⌄</span></button>
      <div className="git-commit-box"><label className="sr-only" htmlFor={`git-message-${id}`}>커밋 메시지</label><textarea id={`git-message-${id}`} value={commit} disabled={busy} maxLength={500} placeholder="메시지 (Ctrl+Enter로 커밋 검토)" rows={3} onChange={e=>setCommit(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.nativeEvent.isComposing&&commit.trim()&&staged.length&&!dirty){e.preventDefault();void work(()=>prepare('commit'));}}}/><button className="git-primary" disabled={busy||dirty||!commit.trim()||!staged.length||view.conflicts} onClick={()=>void work(()=>prepare('commit'))}>✓ 커밋 검토</button></div>
      {view.conflicts&&<p className="git-warning" role="alert">충돌 파일을 편집한 뒤 스테이징하세요.</p>}{dirty&&<p className="git-warning">편집 중인 파일을 저장하면 Git 작업을 진행할 수 있습니다.</p>}
      {!!conflicts.length&&group('병합 변경 사항',conflicts,false,true)}{group('스테이징된 변경 사항',staged,true)}{group('변경 사항',unstaged,false)}
      <button className="git-history-link" onClick={()=>{setFilter('');setDialog('history');}}>⑂ 커밋 그래프 · 이력 <span>{view.history.length}</span></button>
      <div className="git-connection"><span>{view.github?`GitHub · ${view.github}`:'GitHub 연결'}</span><button onClick={()=>setDialog('connection')}>{view.github?'관리':'설정'}</button></div>
    </>:<p className="git-empty">Git 저장소를 읽는 중이거나 사용할 수 없습니다. 프로젝트 루트 폴더를 열고 새로고침하세요.</p>}
    {error&&<p className="git-error" role="alert">{error}</p>}<p className="git-result" role="status">{busy?'Git 처리 중…':message}</p>{url&&<button onClick={()=>void window.desktop.openSource(url)}>생성된 PR 열기 ↗</button>}
    {!approval&&dialog&&createPortal(<AppDialog label={dialog==='branches'?'브랜치 선택':dialog==='history'?'커밋 그래프와 이력':dialog==='remote'?'Git 원격 작업':'GitHub 연결 설정'} onClose={()=>{if(!busy)setDialog(null);}}><div className="git-dialog">
      {dialog==='branches'&&<><h2>브랜치 선택</h2><p className="git-dialog-note">현재 {view?.branch||'분리된 HEAD'} · {view?.head.slice(0,7)||'첫 커밋 전'}</p><input autoFocus aria-label="브랜치 검색 또는 새 이름" value={branchQuery} maxLength={200} onChange={e=>setBranchQuery(e.target.value)} placeholder="브랜치 검색 또는 새 이름"/><div className="git-branches">{view?.branches.filter(b=>b.toLowerCase().includes(branchQuery.toLowerCase())).map(b=><button key={b} aria-label={`브랜치 ${b}`} disabled={busy||dirty||b===view.branch} onClick={()=>void work(()=>prepare('checkout',[],b))}><span>⑂</span><strong>{b}</strong><small>{b===view.branch?'현재':view.branchHeads[b]?.slice(0,7)}</small></button>)}</div><button className="git-primary" disabled={busy||dirty||!branchQuery.trim()||!view?.head||view.branches.includes(branchQuery.trim())} onClick={()=>void work(()=>prepare('create-branch',[],branchQuery.trim()))}>＋ 새 브랜치 만들기 · {branchQuery.trim()}</button><p className="git-dialog-note">브랜치 전환·생성은 저장소 변경이 없을 때 검토 후 실행합니다.</p></>}
      {dialog==='history'&&<><h2>커밋 그래프</h2><div className="git-history-toolbar"><span>{view?.branch} · 최근 최대 60개</span><input aria-label="커밋 이력 검색" placeholder="메시지·작성자·브랜치·해시 검색" value={filter} onChange={e=>setFilter(e.target.value)}/></div><div className="git-history-layout"><div className="git-history-list">{!commits.length&&<p className="git-empty">표시할 커밋이 없습니다.</p>}{commits.map(c=>{const g=graphs[view!.history.indexOf(c)],color=graphColors[g.lane%graphColors.length];return <button className="git-history-row" key={c.id} aria-label={`커밋 ${c.id.slice(0,7)} ${c.subject}`} aria-pressed={selectedCommit?.id===c.id} onClick={()=>void inspect(c)}><svg width={graphWidth} height="46" aria-hidden="true">{g.incoming.map(l=><line key={l} x1={l*12+8} y1="0" x2={l*12+8} y2="46" stroke={graphColors[l%graphColors.length]} strokeWidth="2"/>)}<line x1={g.lane*12+8} y1="0" x2={g.lane*12+8} y2="15" stroke={color} strokeWidth="2"/>{g.outgoing.map((l,i)=><path key={i} d={`M ${g.lane*12+8} 15 L ${l*12+8} 32 L ${l*12+8} 46`} stroke={color} fill="none" strokeWidth="2"/>)}<circle cx={g.lane*12+8} cy="15" r={c.id===view?.head?5:4} fill={color}/></svg><span className="git-commit-description"><strong>{c.refs.map(ref=><em key={ref}>{ref}</em>)}{c.subject}</strong><small>{c.author} · {c.date.slice(0,16).replace('T',' ')} · <code>{c.id.slice(0,7)}</code></small></span></button>;})}</div><div className="git-commit-detail">{selectedCommit?<><h3>{selectedCommit.subject}</h3><p>{selectedCommit.author} · {selectedCommit.date.slice(0,16).replace('T',' ')}</p><code>{selectedCommit.id}</code><h4>변경 파일 {commitFiles?.files.length??'…'}</h4>{commitFiles?.files.map(file=><button className="git-history-file" key={file.path} disabled={busy||file.blocked} title={file.path} onClick={()=>void work(async()=>{const result=await window.desktop.git({action:'commit-diff',id,commit:selectedCommit.id,path:file.path});if(live.current&&'kind'in result&&result.kind==='file-diff'){onDiff?.(result);setDialog(null);}})}><b data-status={file.status}>{file.status}</b><span>{file.path}</span>{file.blocked&&<small>보호</small>}</button>)}</>:<p className="git-empty">커밋을 선택하면 작성자와 변경 파일을 볼 수 있습니다. 파일을 클릭하면 편집기에서 Diff를 엽니다.</p>}</div></div></>}
      {dialog==='remote'&&<><h2>Git 원격 작업</h2><p className="git-dialog-note">{view?.branch} → {view?.remote||'지원하는 HTTPS GitHub origin이 없습니다.'}</p><p>{view?.upstream?`${view.upstream} 기준 · 받을 커밋 ${view.behind} · 보낼 커밋 ${view.ahead}`:'추적 브랜치가 없습니다. 원격 작업 검토 시 실제 원격 상태를 확인합니다.'}</p><div className="git-remote-actions"><button disabled={busy||dirty||!view?.remote} onClick={()=>void work(()=>prepare('pull'))}>↓ Pull 검토</button><button disabled={busy||dirty||!view?.remote} onClick={()=>void work(()=>prepare('push'))}>↑ Push 검토</button></div><details><summary>Draft Pull Request 만들기</summary><label>PR 대상 브랜치<input value={base} onChange={e=>setBase(e.target.value)}/></label><label>PR 제목<input value={title} maxLength={500} onChange={e=>setTitle(e.target.value)}/></label><label>PR 설명<textarea value={body} maxLength={8000} rows={5} onChange={e=>setBody(e.target.value)}/></label><button disabled={busy||dirty||!view?.remote||!title.trim()} onClick={()=>void work(()=>prepare('pr'))}>Draft PR 검토</button></details><p className="git-dialog-note">원격 비교를 위해 fetch하며, 실행은 검토 후 승인합니다. Pull은 fast-forward만 허용합니다.</p></>}
      {dialog==='connection'&&<><h2>GitHub 연결 설정</h2><p>{view?.github?`${view.github} 연결됨`:'GitHub 연결은 Push·Pull·PR을 사용할 때 필요합니다. 로컬 스테이징과 커밋은 별도로 사용할 수 있습니다.'}</p><button disabled={busy} onClick={()=>void work(()=>refresh(true))}>GitHub 연결 확인</button><p>터미널에서 브라우저로 로그인하세요.</p><pre className="git-patch">gh auth login --web --hostname github.com --git-protocol https{'\n'}gh auth setup-git --hostname github.com</pre><p className="git-dialog-note">운영체제 자격 증명 저장소를 사용하세요. 평문 토큰 저장 상태는 연결을 거부합니다. 저장소: {view?.root}</p></>}
      {error&&<p role="alert" className="git-error">{error}</p>}{busy&&<p role="status">Git 처리 중…</p>}
    </div></AppDialog>,document.body)}
    {approval&&createPortal(<AppDialog label="Git 작업 승인" onClose={()=>{if(!busy)setApproval(undefined);}}><div className="git-dialog git-review"><h2>{operationNames[approval.intent.operation]} 검토</h2><dl><dt>저장소</dt><dd>{approval.view.root}</dd><dt>브랜치</dt><dd>{approval.view.branch}{['checkout','create-branch'].includes(approval.intent.operation)?` → ${approval.intent.base}`:''}</dd>{approval.intent.files.length>0&&<><dt>선택 파일</dt><dd>{approval.intent.files.join(', ')}</dd></>}{approval.intent.message&&approval.intent.operation==='commit'&&<><dt>커밋 메시지</dt><dd>{approval.intent.message}</dd></>}{['push','pull','pr'].includes(approval.intent.operation)&&<><dt>원격 / 계정</dt><dd>{approval.view.remote} · {approval.view.github}</dd></>}</dl>{approval.intent.operation==='pr'&&<><h3>{approval.intent.title}</h3><p>{approval.intent.body}</p></>}<Patch text={approval.diff||'파일 변경 내용 없음'}/><details><summary>비교 이력</summary><Patch text={approval.commits}/></details><p className="git-dialog-note">상태가 바뀌거나 2분이 지나면 승인이 취소됩니다. 저장소의 Git hook과 필터는 OS 사용자 권한으로 실행됩니다.</p><div className="git-review-actions"><button disabled={busy} onClick={()=>void work(async()=>{await window.desktop.git({action:'decide',id,token:approval.token,digest:approval.digest,accept:false});if(live.current){setApproval(undefined);setMessage('거절했습니다.');}})}>거절</button><button className="git-primary" disabled={busy||dirty} onClick={()=>void work(async()=>{const result=await window.desktop.git({action:'decide',id,token:approval.token,digest:approval.digest,accept:true});if(live.current){setApproval(undefined);onDiff?.(undefined);if('message'in result){setMessage(result.message);setURL(result.url||'');}if(approval.intent.operation==='commit')setCommit('');await refresh();}})}>확인한 작업 실행</button></div>{error&&<p role="alert" className="git-error">{error}</p>}</div></AppDialog>,document.body)}
  </section>;
}
