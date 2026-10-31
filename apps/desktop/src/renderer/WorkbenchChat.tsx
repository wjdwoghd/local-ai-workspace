import { useEffect, useRef, useState } from 'react';
import type { WorkspaceInfo, WorkspaceSearch } from '../../../../packages/shared-types/workspace';
import type { ChatMessage, ChatStatus } from '../../../../packages/shared-types/chat';
import type { ConversationMeta } from '../../../../packages/shared-types/auth';
import type { AgentView } from '../../../../packages/shared-types/agent';
import { Sources } from './Documents';
import { WorkspaceEditor } from './WorkspaceEditor';
import { request } from './api';
import { ChatConnectionNotice, ConnectionFeedback } from './ChatConnectionNotice';
import { AttachmentList, AttachmentPicker, useAttachments } from './Attachments';
import { projectDescription,projectInventory,projectReferences,type ProjectInventory } from './project-context';
import { ReasoningPicker,useReasoning } from './ReasoningPicker';

export function WorkbenchChat({ info, local, paths, dirty, onOpen, focusRequest = 0,reasoningScope='',workspaceBusy=false }: { info: WorkspaceInfo | null; local: boolean; paths: string[]; dirty: boolean; onOpen(path: string): void; focusRequest?: number;reasoningScope?:string;workspaceBusy?:boolean }) {
  const [draft, setDraft] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const attachment = useAttachments(setError);
  const [messages, setMessages] = useState<ChatMessage[]>([]), [status, setStatus] = useState<ChatStatus>();
  const [results, setResults] = useState<WorkspaceSearch>(), [view, setView] = useState<AgentView>();
  const [model, setModel] = useState(''), [checking, setChecking] = useState(false), [progress, setProgress] = useState('');
  const reasoning=useReasoning(reasoningScope,status?.models.find(m=>m.id===model));
  const [connectionCheckedAt, setConnectionCheckedAt] = useState<number>();
  const [inventory,setInventory]=useState<ProjectInventory>(),[failedPrompt,setFailedPrompt]=useState('');
  const sending=useRef(false),failedUsers=useRef(new Set<string>());
  const conversation = useRef(''), alive = useRef(true), operation = useRef(0), input = useRef<HTMLTextAreaElement>(null);
  const codingMode = useRef<'ask' | 'edit'>('ask');
  async function refreshStatus(manual = false) {
    setChecking(true);
    try { const s = await request<ChatStatus>({ action: 'chatStatus' }); if (alive.current) { setStatus(s); setModel(value => s.models.some(m => m.id === value) ? value : s.models[0]?.id || ''); setError(''); } }
    catch (e) { if (alive.current) { const message=(e as Error).message;setError(message);setStatus(previous=>({configured:false,models:previous?.models??[],message})); } }
    finally { if (alive.current) { setChecking(false);if(manual)setConnectionCheckedAt(Date.now()); } }
  }
  useEffect(() => {
    alive.current = true; void refreshStatus();
    return () => { alive.current = false; operation.current++; void window.desktop.cancelChat(); };
  }, [local]);
  useEffect(() => { if (focusRequest) { setDraft('프로젝트에서 '); input.current?.focus(); } }, [focusRequest]);
  async function submit() {
    const attached=attachment.attachments;
    const text = draft.trim() || (attached.length?'첨부한 파일과 이미지를 분석해 주세요.':''); if (!text || busy || workspaceBusy || sending.current || attachment.loading || !status?.configured || !model) return;
    sending.current=true;
    const generation = ++operation.current;
    const check = () => { if (!alive.current || generation !== operation.current) throw new Error('중단된 요청'); };
    const assistant = crypto.randomUUID(),userId=crypto.randomUUID();
    setBusy(true); setError('');setFailedPrompt(''); setProgress(info?'프로젝트 파일 목록을 확인하고 있습니다…':'요청을 확인하고 있습니다…'); setView(undefined); setResults(undefined); setDraft('');
    setMessages(m => [...m, { id:userId, role: 'user', text, model, ...(attached.length?{attachments:attached}:{}) }, { id: assistant, role: 'assistant', text: '', model }]);
    const answer = (text: string) => setMessages(m => m.map(v => v.id === assistant ? { ...v, text } : v));
    try {
      const listing=info?await projectInventory(info,paths,window.desktop.workspace,check):undefined;check();if(listing)setInventory(listing);
      const available=listing?.files||[],description=info&&listing?projectDescription(info,listing,paths):'';
      const history = messages.filter(m=>!failedUsers.current.has(m.id)).slice(-5).map(m => ({ role:m.role, text:m.text.slice(0,2000) }));
      const planHistory=description?[{role:'user' as const,text:description},...history]:history;
      const plan = !attached.length && local ? await window.desktop.planChat({ prompt: text, model,...(reasoning.effort?{reasoningEffort:reasoning.effort}:{}), files: available, history:planHistory }) : { kind: 'chat' as const, query: '', mode: 'ask' as const, paths: [] };
      check();
      if (plan.kind === 'code' && info && plan.paths.length) {
        if (dirty) throw new Error('편집 중인 내용을 저장한 뒤 다시 요청하세요.');
        codingMode.current = plan.mode; setProgress('관련 파일을 분석하고 있습니다…');
        const budget=Math.max(0,3900-text.length),prior=(description+'\n이전 대화(참고 데이터):\n'+JSON.stringify(history)).slice(0,budget);
        const prompt = prior?`${prior}\n현재 요청:\n${text}`:text;
        const result = await window.desktop.agent.execute({ action: 'generate', id: info.id, mode: plan.mode, paths: plan.paths, prompt, model,...(reasoning.effort?{reasoningEffort:reasoning.effort}:{}) });
        check();if(result.state==='failed'||result.state==='setup-required')throw new Error(result.message);setView(result); answer(result.message); return;
      }
      let projectContext: { path: string; text: string }[] | undefined=info&&listing?await projectReferences(info,listing,paths,plan.paths,window.desktop.workspace,check):undefined;check();
      if (plan.kind === 'files') {
        if (!info) throw new Error('프로젝트를 열면 해당 폴더에서 파일을 찾을 수 있습니다.');
        setProgress('프로젝트 파일을 찾고 있습니다…');
        const found = await window.desktop.workspace.search(info.id, plan.query); check(); setResults(found);
        projectContext = [...(description?[{path:'workspace-context',text:description}]:[]),...found.hits.slice(0,19).map(hit => ({ path: hit.path, text: `줄 ${hit.line}: ${hit.text}` }))];
        if (!found.hits.length) { answer(`프로젝트에서 “${plan.query}”에 해당하는 파일이나 내용을 찾지 못했습니다.`); return; }
      }
      if (!conversation.current) { const meta = await request<ConversationMeta>({ action: 'createConversation', title: text.slice(0, 80) }); check(); conversation.current = meta.id; }
      setProgress(plan.kind==='code'?'프로젝트를 참고해 코드를 작성하고 있습니다…':'답변을 작성하고 있습니다…');
      const result = await window.desktop.streamChat({ id: conversation.current, text, model,...(reasoning.effort?{reasoningEffort:reasoning.effort}:{}), autoTools: true, ...(projectContext ? { projectContext } : {}), documentSearch: !local, ...(attached.length?{attachments:attached}:{}) }, event => {
        if (!alive.current || generation !== operation.current) return;
        if (event.type === 'delta') setMessages(m => m.map(v => v.id === assistant ? { ...v, text: v.text + event.text } : v));
        if (event.type === 'sources') setMessages(m => m.map(v => v.id === assistant ? { ...v, citations: event.citations } : v));
      });
      check(); if (!result.ok) { if (result.status === 401) window.dispatchEvent(new Event('session-expired')); throw new Error(result.message); }
      attachment.clear();
    } catch (e) {
      if (alive.current && generation === operation.current) { const message = (e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); setError(message);setFailedPrompt(text);failedUsers.current.add(userId);setMessages(m=>m.filter(v=>v.id!==assistant)); }
    } finally { if (alive.current && generation === operation.current) { sending.current=false;setBusy(false); setProgress(''); } }
  }
  async function stop() {
    const stopped=++operation.current;setBusy(true); setProgress('중단하고 있습니다…');
    try {
      await window.desktop.cancelChat();
      if (info) await window.desktop.agent.execute({ action: 'stop', id: info.id, mode: codingMode.current });
    } catch(e) {if(alive.current&&stopped===operation.current)setError((e as Error).message);}
    finally {if (alive.current&&stopped===operation.current) {sending.current=false;setBusy(false);setView(undefined);setProgress('중단했습니다.');}}
  }
  async function decide(accept: boolean) {
    if (!info || !view?.approval || busy) return;
    const approval = view.approval, generation = ++operation.current; setBusy(true); setError('');
    try {
      const result = await window.desktop.agent.execute({ action: 'decide', id: info.id, mode: codingMode.current, approval: approval.id, digest: approval.digest, accept });
      if (alive.current && generation === operation.current) { setView(result); setProgress(result.message); }
    } catch (e) { if (alive.current && generation === operation.current) setError((e as Error).message); }
    finally { if (alive.current && generation === operation.current) setBusy(false); }
  }
  const choices = status?.models.length ? status.models : [{ id: '', label: 'GPT-6.1 Sol' }, { id: 'unavailable', label: 'Astra · 서버 연결 필요' }];
  return <section className="workbench-chat" aria-label="통합 챗봇">
    <header className="pane-heading"><strong>CHAT</strong><select aria-label="챗봇 모델" value={model} disabled={busy || workspaceBusy || !status?.models.length} onChange={e => { setModel(e.target.value); setError(''); }}>{choices.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select><button disabled={busy || workspaceBusy || checking} aria-busy={checking} onClick={() => void refreshStatus(true)}>{checking ? '확인 중…' : '연결 새로고침'}</button></header>
    <ConnectionFeedback status={status} checking={checking} checkedAt={connectionCheckedAt} />
    <ReasoningPicker value={reasoning.effort} levels={reasoning.levels} onChange={reasoning.select} disabled={busy||workspaceBusy}/>
    <div className="work-project-context" role="status" title={info?.root}>{info?<><strong>연결된 프로젝트: {info.name}</strong><small>{inventory?`${inventory.files.length}개 파일 인식${inventory.limited?' · 일부 조회':''}`:'요청할 때 파일 목록과 관련 코드를 확인합니다.'}</small></>:<span>프로젝트를 열면 해당 폴더를 참고해 답변합니다.</span>}</div>
    <div className="workbench-chat-scroll" aria-live="polite">
      {!messages.length && <div className="chat-intro"><span className="codicon codicon-comment-discussion" aria-hidden="true" /><h2>무엇을 도와드릴까요?</h2><p>질문이나 작업을 입력하세요. 필요한 검색과 코드 작업을 이어서 처리합니다.</p></div>}
      {messages.map(m => <article className={`workbench-message ${m.role}`} key={m.id}><strong>{m.role === 'user' ? '나' : status?.models.find(option => option.id === m.model)?.label || m.model}</strong><AttachmentList files={m.attachments||[]} /><Sources text={m.text || progress || '응답 대기 중…'} citations={m.citations || []} /></article>)}
      {results && <div aria-label="프로젝트 검색 결과"><p>{results.hits.length}개 결과{results.limited ? ' · 일부 결과' : ''}</p>{results.hits.map((hit, i) => <button className="workbench-search-hit" key={`${hit.path}:${hit.line}:${i}`} onClick={() => onOpen(hit.path)}><strong>{hit.path}:{hit.line}</strong><span>{hit.text}</span></button>)}</div>}
      {view?.approval && <div className="agent-approval"><strong>파일 수정 승인</strong>{view.approval.changes.map(change => <div key={change.path}><p>{change.path}</p><div className="agent-diff"><WorkspaceEditor path={change.path} original={change.before} text={change.after} readOnly onChange={() => {}} onSave={() => {}} /></div></div>)}<button disabled={dirty || busy} onClick={() => void decide(true)}>이번 수정 승인</button><button disabled={busy} onClick={() => void decide(false)}>거절</button></div>}
      {!!view?.applied.length && <p role="status">적용: {view.applied.join(', ')}</p>}
      {error && <div className="chat-error"><p role="alert">{error}</p>{failedPrompt&&<button disabled={busy} onClick={()=>{setDraft(failedPrompt);setFailedPrompt('');input.current?.focus();}}>실패한 요청 다시 입력</button>}</div>}
    </div>
    <ChatConnectionNotice status={status} checking={checking} onRefresh={() => void refreshStatus(true)} id="work-chat-availability" />
    <form className="workbench-composer" onDragOver={e=>{if(!busy)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(!busy)attachment.drop(e);}} onSubmit={e => { e.preventDefault(); void submit(); }}>
      <AttachmentPicker files={attachment.attachments} add={attachment.add} remove={attachment.remove} disabled={busy} loading={attachment.loading} />
      {!local && <button type="button" disabled={busy} onClick={async()=>{try{const result=await window.desktop.importDocument(null);if(!result.ok)throw new Error(result.message);if(result.data)setProgress('개인 문서를 등록했습니다.');}catch(e){setError((e as Error).message);}}}>개인 문서 선택·등록</button>}
      <textarea ref={input} disabled={workspaceBusy} onPaste={e=>{if(!busy&&!workspaceBusy)attachment.paste(e);}} aria-label="통합 챗봇 입력" placeholder="질문하거나 작업을 요청하세요…" value={draft} onChange={e => setDraft(e.target.value)} maxLength={4000} rows={3} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
      <div><small role="status">{progress || '필요에 따라 검색 · 코드 작업'}</small><button disabled={busy || workspaceBusy || attachment.loading || (!draft.trim()&&!attachment.attachments.length) || !status?.configured || !model}>보내기</button>{busy && <button type="button" onClick={() => void stop()}>중단</button>}</div>
      <small>요청에 필요한 프로젝트 파일을 AI에 전달합니다. 파일 수정은 승인 후 적용합니다.</small>
    </form>
  </section>;
}
