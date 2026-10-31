import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ThemePreference } from "../../../../packages/shared-types/ipc/desktop";
import { demoReply } from "./features/chat/demo";
import type { ChatMessage, ChatStatus } from '../../../../packages/shared-types/chat';
import type { User, Settings, ConversationMeta } from "../../../../packages/shared-types/auth";
import { request } from "./api";
import { Documents, Sources } from './Documents';
import { Workspace } from './Workspace';
import { Collaboration } from './Collaboration';
import { AppDialog } from './AppDialog';
import { ChatConnectionNotice, ConnectionFeedback } from './ChatConnectionNotice';
import { AttachmentList, AttachmentPicker, useAttachments } from './Attachments';
import { ReasoningPicker,useReasoning } from './ReasoningPicker';

const themes: {
  value: ThemePreference;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    value: "light",
    label: "라이트",
    icon: "☀",
    description: "밝고 선명한 화면",
  },
  {
    value: "dark",
    label: "다크",
    icon: "☾",
    description: "눈이 편안한 어두운 화면",
  },
  {
    value: "system",
    label: "시스템",
    icon: "◐",
    description: "기기 설정에 맞춰 자동 전환",
  },
];

const freshDraft = () => ({id:`draft-${crypto.randomUUID()}`,title:'새 대화',messages:[] as ChatMessage[]});
export default function App({ user, initial, local=false, controls, extraSettings, onThemeChange }: { user: User; initial: { settings: Settings; conversations: ConversationMeta[] }; local?:boolean; controls?:ReactNode; extraSettings?:ReactNode; onThemeChange?(theme:ThemePreference):void }) {
  const [conversations, setConversations] = useState<(ConversationMeta & { messages: ChatMessage[] })[]>(() => initial.conversations.length?initial.conversations.map(c => ({ ...c, messages: [] })):[freshDraft()]);
  const [demoMessages, setDemoMessages] = useState<Record<string, ChatMessage[]>>({});
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<ChatStatus>();
  const reasoning=useReasoning(user.id,status?.models.find(m=>m.id===model));
  const [checking, setChecking] = useState(false);
  const [connectionCheckedAt, setConnectionCheckedAt] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const [activeId, setActiveId] = useState(conversations[0].id);
  const skipHistory=useRef('');
  const [page, setPage] = useState<'chat'|'workspace'>('chat');
  const [overlay,setOverlay]=useState<'settings'|'documents'|'collaboration'|null>(null);
  const [sidebarOpen,setSidebarOpen]=useState(true);
  useEffect(() => { const show = () => setPage('workspace'); window.addEventListener('workspace-focus', show); return () => window.removeEventListener('workspace-focus', show); }, []);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(page==='chat'&&e.ctrlKey&&e.code==='KeyB'){e.preventDefault();setSidebarOpen(v=>!v);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[page]);
  const [webSearch, setWebSearch] = useState(false);
  const [documentSearch, setDocumentSearch] = useState(false);
  const [draft, setDraft] = useState("");
  const [failedRequest,setFailedRequest]=useState<{id:string;text:string}>();
  const [theme, setTheme] = useState<ThemePreference>(initial.settings.theme);
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const attachment = useAttachments(setError);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stored = conversations.find((item) => item.id === activeId)!;
  const demo = model === 'demo';
  const current = demo ? { ...stored, messages: demoMessages[activeId] ?? [] } : stored;

  async function refreshStatus(manual = false) {
    setChecking(true);
    try { const s=await request<ChatStatus>({action:'chatStatus'}); if(alive.current){setStatus(s);setError('');setModel(value=>value==='demo'||s.models.some(m=>m.id===value)?value:s.models[0]?.id||'');} }
    catch(e){if(alive.current){const message=(e as Error).message;setError(message);setStatus(previous=>({configured:false,models:previous?.models??[],message}));}}
    finally{if(alive.current){setChecking(false);if(manual)setConnectionCheckedAt(Date.now());}}
  }

  useEffect(()=>{
    if(!local)return;let live=true;
    void request<ConversationMeta[]>({action:'conversations'}).then(items=>{if(live&&items.length){setConversations(old=>[...old,...items.filter(c=>!old.some(o=>o.id===c.id)).map(c=>({...c,messages:[]}))]);}}).catch(()=>{});
    return()=>{live=false;};
  },[local]);

  useEffect(() => {
    alive.current = true;
    void refreshStatus();
    return () => { alive.current = false; void window.desktop.cancelChat(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    if(activeId.startsWith('draft-')||skipHistory.current===activeId){skipHistory.current='';setLoading(false);return;}
    request<ChatMessage[]>({ action: 'messages', id: activeId }).then(messages => {
      if (!cancelled) {
        setConversations(items => items.map(c => c.id === activeId ? { ...c, messages } : c));
        setLoading(false);
      }
    }).catch(e => { if (!cancelled) { setError(e.message); setLoading(true); } });
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    window.desktop
      .getInfo()
      .then((info) => {
        setVersion(info.version);
        setReady(true);
      })
      .catch(() =>
        setError("앱 정보를 불러오지 못했습니다. 앱을 다시 실행해 주세요."),
      );
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(()=>setTheme(initial.settings.theme),[initial.settings.theme]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [current.messages, page, activeId]);

  async function newChat() {
    if (sending.current) return;
    try {
      const meta = local?freshDraft():await request<ConversationMeta>({ action: "createConversation", title: "새 대화" });
      const chat = { ...meta, messages: [] };
      setConversations((items) => [chat, ...items]);
      setActiveId(chat.id); setPage("chat"); setDraft(""); attachment.clear();
      requestAnimationFrame(() => input.current?.focus());
    } catch (e) { setError((e as Error).message); }
  }
  async function send(text = draft) {
    text = text.trim() || (attachment.attachments.length ? '첨부한 파일과 이미지를 분석해 주세요.' : '');
    const attached = attachment.attachments;
    if (!text || text.length > 4000 || sending.current || loading || attachment.loading || (!demo && !status?.configured)) return;
    sending.current = true; setBusy(true); setError('');setFailedRequest(undefined);setDraft('');
    let id = activeId;
    const before = stored.messages;
    try {
      if(id.startsWith('draft-')&&!demo){const draftId=id;const meta=await request<ConversationMeta>({action:'createConversation',title:text.slice(0,28)});skipHistory.current=meta.id;setConversations(items=>items.map(c=>c.id===draftId?{...meta,messages:[]}:c));id=meta.id;setActiveId(meta.id);}
      if (demo) {
        const title = current.messages.length ? current.title : text.slice(0, 28);
        await request({ action: 'updateConversation', id, title });
        setConversations(items => items.map(c => c.id === id ? { ...c, title } : c));
        setDemoMessages(items => ({ ...items, [id]: [...(items[id] ?? []),
          { id: crypto.randomUUID(), role: 'user', text, model: 'demo' },
          { id: crypto.randomUUID(), role: 'assistant', text: demoReply(text), model: 'demo' }] }));
        return;
      }
      const assistantId = crypto.randomUUID();
      setConversations(items => items.map(c => c.id === id ? { ...c, messages: [...before,
        { id: crypto.randomUUID(), role: 'user', text, model, ...(attached.length?{attachments:attached}:{}) },
        { id: assistantId, role: 'assistant', text: '', model }] } : c));
      const result = await window.desktop.streamChat({ id, text, model,...(reasoning.effort?{reasoningEffort:reasoning.effort}:{}), webSearch, documentSearch, ...(attached.length?{attachments:attached}:{}) }, event => {
        if (alive.current && event.type === 'sources') setConversations(items => items.map(c => c.id === id ? { ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, citations: event.citations } : m) } : c));
        if (alive.current && event.type === 'delta') setConversations(items => items.map(c => c.id === id ? {
          ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, text: m.text + event.text } : m),
        } : c));
      });
      if (!alive.current) return;
      if (!result.ok) {
        if (result.status === 401) window.dispatchEvent(new Event('session-expired'));
        throw new Error(result.message);
      }
      attachment.clear();
      const messages = await request<ChatMessage[]>({ action: 'messages', id });
      const meta = await request<ConversationMeta>({ action: 'getConversation', id });
      if (alive.current) setConversations(items => items.map(c => c.id === id ? { ...meta, messages } : c));
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);setFailedRequest({id,text});
        // Reconcile a lost final event: the server may already have committed the turn.
        try {
          const messages = await request<ChatMessage[]>({ action: 'messages', id });
          if (alive.current) setConversations(items => items.map(c => c.id === id ? { ...c, messages } : c));
        } catch {
          if (alive.current) { setLoading(true); setConversations(items => items.map(c => c.id === id ? { ...c, messages: before } : c)); }
        }
      }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  async function changeTheme(value: ThemePreference) {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await request({ action: "saveSettings", theme: value });
      setTheme(value);
      onThemeChange?.(value);
      setNotice("테마 설정을 저장했습니다.");
    } catch {
      setError("테마를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`app-shell mode-shell ${page==='workspace'?'work-mode':'chat-mode'} ${!sidebarOpen?'history-collapsed':''}`}>
      <header className="mode-bar session-bar">
        {page==='chat'&&<button className="mode-icon" aria-label="대화 사이드바 토글" aria-expanded={sidebarOpen} onClick={()=>setSidebarOpen(v=>!v)}>☰</button>}
        {page==='chat'&&!sidebarOpen&&<button aria-label="대화 만들기" disabled={busy} onClick={()=>void newChat()}>＋</button>}
        <strong className="compact-brand">Local AI</strong>
        <nav aria-label="주요 메뉴"><button aria-current={page==='chat'?'page':undefined} onClick={()=>{setOverlay(null);setPage('chat');}}>Chat</button><button aria-current={page==='workspace'?'page':undefined} onClick={()=>{setOverlay(null);setPage('workspace');}}>Work</button></nav>
        <div className="mode-bar-spacer" />
        <details className="mode-tools" onClick={e=>{if((e.target as HTMLElement).closest('button'))e.currentTarget.open=false;}}><summary>도구</summary><div><button onClick={()=>{setOverlay('settings');setNotice('');}}>설정</button>{!local&&<><button onClick={()=>setOverlay('documents')}>문서 관리</button><button onClick={()=>setOverlay('collaboration')}>팀 자료·사용량</button></>}</div></details>
        {controls}
      </header>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="사이드바" hidden={page==='workspace'||!sidebarOpen}>
        <button className="new-chat" onClick={newChat} disabled={busy}>
          <span aria-hidden="true">＋</span> 새 대화 <kbd>↵</kbd>
        </button>
        <div className="history-label">
          내 대화 <span>{conversations.length}</span>
        </div>
        <nav className="history" aria-label="대화 목록">
          {conversations.map((chat) => (
            <button
              key={chat.id}
              disabled={busy}
              className={`history-item ${page === "chat" && chat.id === activeId ? "active" : ""}`}
              aria-current={
                page === "chat" && chat.id === activeId ? "true" : undefined
              }
              onClick={() => {
                setActiveId(chat.id);
                setDraft("");
                attachment.clear();
                setPage("chat");
              }}
            >
              <span aria-hidden="true">◦</span>
              <span>{chat.title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" /> {demo ? '로컬 데모 모드' : 'AI 채팅'}
            <p>{demo ? 'Astra · 실제 AI 연결 없음' : status?.message || 'AI 설정 확인 중…'}</p>
          </div>
          <div className="profile">
            <span className="avatar">나</span>
            <div>
              {user.username}<small>개인 워크스페이스</small>
            </div>
          </div>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        {error && (
          <div className="error" role="alert">
            {error}
            {failedRequest?.id===activeId&&<button disabled={busy} onClick={()=>{setDraft(failedRequest.text);setFailedRequest(undefined);input.current?.focus();}}>실패한 요청 다시 입력</button>}
          </div>
        )}
        <div className="workspace-container" hidden={page !== 'workspace'}><Workspace local={local} visible={page==='workspace'} reasoningScope={user.id}/></div>
        {page === "chat" && (
          <section className="chat-page" aria-label="채팅 화면">
            <div className="chat-heading">
              <div>
                <h1>
                  {current.messages.length ? current.title : "새로운 대화"}
                </h1>
                <p>생각을 정리하는 나만의 공간</p>
              </div>
              <label className="model-picker">모델 선택
                <select aria-label="모델 선택" value={model} disabled={busy} onChange={e => { setModel(e.target.value); setError(''); }}>
                  {(status?.models ?? [{ id: '', label: 'GPT-6.1 Sol · 설정 확인 중' }]).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  {!local&&<option value="demo">Astra · 로컬 데모</option>}
                </select>
              </label>
              <ReasoningPicker value={reasoning.effort} levels={reasoning.levels} onChange={reasoning.select} disabled={busy||model==='demo'}/>
              <button disabled={busy || checking} aria-busy={checking} onClick={()=>void refreshStatus(true)}>{checking ? '확인 중…' : '연결 확인'}</button>
              <button disabled={busy} onClick={async () => {
                try {
                  let remaining = conversations.filter(c => c.id !== activeId);
                  // Create a replacement first so a failed request never leaves an empty UI.
                  if (!remaining.length) remaining = local?[freshDraft()]:[{ ...await request<ConversationMeta>({ action: "createConversation", title: "새 대화" }), messages: [] }];
                  if(!activeId.startsWith('draft-'))await request({ action: "deleteConversation", id: activeId });
                  setConversations(remaining); setActiveId(remaining[0].id); setDraft(""); attachment.clear();
                } catch (e) { setError((e as Error).message); }
              }}>대화 삭제</button>
            </div>
            <ConnectionFeedback status={status} checking={checking} checkedAt={connectionCheckedAt} />
            <div
              className={`message-scroll ${current.messages.length ? "" : "empty-scroll"}`}
            >
              {loading ? <p className="chat-loading">대화를 불러오는 중… <button onClick={() => { void request<ChatMessage[]>({ action: 'messages', id: activeId }).then(messages => { setConversations(items => items.map(c => c.id === activeId ? { ...c, messages } : c)); setLoading(false); setError(''); }).catch(e => setError(e.message)); }}>다시 불러오기</button></p> : current.messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-icon" aria-hidden="true">
                    ✳
                  </div>
                  <div className="eyebrow">YOUR SPACE TO THINK</div>
                  <h2>
                    오늘은 어떤 생각을
                    <br />
                    함께 정리해 볼까요?
                  </h2>
                  <p>
                    작은 아이디어부터 하루의 계획까지.
                    <br />
                    아래 예시를 선택하거나 편하게 말을 걸어 보세요.
                  </p>
                  <div className="suggestions">
                    {[
                      {
                        icon: "☀",
                        title: "하루를 가볍게 시작하기",
                        text: "오늘 할 일의 계획을 세워줘",
                      },
                      {
                        icon: "✧",
                        title: "워크스페이스 알아보기",
                        text: "어떤 기능을 사용할 수 있어?",
                      },
                    ].map((item) => (
                      <button key={item.title} disabled={busy || (!demo && !status?.configured)} onClick={() => send(item.text)}>
                        <span aria-hidden="true">{item.icon}</span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.text} <span aria-hidden="true">↗</span>
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="messages"
                  role="log"
                  aria-label="메시지"
                  aria-live="polite"
                >
                  {current.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.role}`}
                    >
                      <div className="message-avatar" aria-hidden="true">
                        {message.role === "user" ? "나" : "✳"}
                      </div>
                      <div>
                        <div className="message-label">
                          {message.role === "user" ? "나" : "Local AI"}
                          {message.role === "assistant" && (
                            <span>{message.model === 'demo' ? '데모 응답' : `${status?.models.find(m => m.id === message.model)?.label ?? message.model} · 실제 AI 응답`}</span>
                          )}
                        </div>
                        <AttachmentList files={message.attachments||[]} />
                        <Sources text={message.text || '응답 생성 중…'} citations={message.citations} />
                      </div>
                    </article>
                  ))}
                  <div ref={end} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <AttachmentPicker files={attachment.attachments} add={attachment.add} remove={attachment.remove} loading={attachment.loading} disabled={busy||demo} />
              {!demo && <ChatConnectionNotice status={status} checking={checking} onRefresh={()=>void refreshStatus(true)} id="chat-availability" />}
              <fieldset className="search-options" disabled={busy || demo}><legend className="sr-only">답변 검색 도구</legend><label><input type="checkbox" checked={webSearch} onChange={e => setWebSearch(e.target.checked)} /> 웹 검색</label>{!local&&<label><input type="checkbox" checked={documentSearch} onChange={e => setDocumentSearch(e.target.checked)} /> 개인·팀 문서 검색</label>}{!local&&<button onClick={()=>setOverlay('documents')}>파일 첨부·관리</button>}<small>{demo ? '데모에서는 검색하지 않습니다.' : documentSearch ? '관련 문서 구간이 AI 제공업체로 전송됩니다.' : ''}</small></fieldset>
              <form
                className="composer"
                onDragOver={e=>{if(!busy&&!demo)e.preventDefault();}}
                onDrop={e=>{e.preventDefault();if(!busy&&!demo)attachment.drop(e);}}
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className="sr-only" htmlFor="message">
                  메시지 입력
                </label>
                <textarea
                  ref={input}
                  id="message"
                  onPaste={e=>{if(!busy&&!demo)attachment.paste(e);}}
                  placeholder="메시지를 입력하세요…"
                  value={draft}
                  disabled={busy || loading}
                  maxLength={4000}
                  rows={2}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-footer">
                  <span>
                    {busy ? '응답 생성 중…' : demo ? '데모 대화' : '개인 AI 대화'}{" "}
                    <span className="composer-hint">
                      · Shift + Enter로 줄바꿈
                    </span>
                  </span>
                  <button
                    className="send"
                    aria-label="메시지 보내기"
                    aria-describedby={!demo && !status?.configured ? 'chat-availability' : undefined}
                    title={!demo && !status?.configured ? status?.message || 'AI 연결 확인 중' : '메시지 보내기'}
                    disabled={(!draft.trim()&&!attachment.attachments.length) || busy || loading || attachment.loading || (!demo && !status?.configured)}
                    type="submit"
                  >
                    ↑
                  </button>
                  {busy && <button type="button" onClick={() => void window.desktop.cancelChat()}>응답 중단</button>}
                </div>
              </form>
              <p className="disclaimer">
                {demo ? 'Astra 데모 응답입니다. 실제 AI 호출은 없습니다. 데모 메시지는 로그아웃·종료 시 사라집니다.' : status?.configured ? '완료된 대화는 내 계정에 저장됩니다. AI 답변에는 오류가 있을 수 있습니다.' : status?.message || '서버 AI 설정을 확인하고 있습니다.'}
              </p>
            </div>
          </section>
        )}
        {overlay && <AppDialog label={overlay==='settings'?'설정':overlay==='documents'?'문서 관리':'팀 자료·사용량'} onClose={()=>setOverlay(null)}>{overlay==='documents'?<Documents user={user}/>:overlay==='collaboration'?<Collaboration user={user}/>:(
          <section className="settings-page" aria-labelledby="settings-title">
            <div className="eyebrow">PREFERENCES</div>
            <h1 id="settings-title">설정</h1>
            <p className="settings-intro">
              나에게 편안한 워크스페이스를 만들어 보세요.
            </p>
            <section className="settings-card">
              <h2>화면 테마</h2>
              <p>선택한 테마는 내 계정에 저장되며 다음 로그인에도 유지됩니다.</p>
              <fieldset disabled={!ready || saving}>
                <legend className="sr-only">화면 테마 선택</legend>
                <div className="theme-options">
                  {themes.map((item) => (
                    <label
                      key={item.value}
                      className={`theme-option ${theme === item.value ? "chosen" : ""}`}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={item.value}
                        checked={theme === item.value}
                        onChange={() => void changeTheme(item.value)}
                      />
                      <span
                        className={`theme-preview ${item.value}`}
                        aria-hidden="true"
                      >
                        <span>{item.icon}</span>
                        <i />
                        <i />
                      </span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="save-notice" role="status">
                {saving ? "저장 중…" : notice}
              </p>
            </section>
            <section className="settings-card about">
              <span className="brand-mark" aria-hidden="true">
                ✳
              </span>
              <div>
                <h2>Local AI Workspace</h2>
                <p>
                  앱 버전{" "}
                  <span data-testid="app-version">
                    {version || "불러오는 중…"}
                  </span>{" "}
                  · 5단계 로컬 개발 환경
                </p>
              </div>
              <span className="pill">{demo ? '로컬 데모' : 'AI 채팅'}</span>
            </section>
            <p className="settings-footnote">
              현재 제공 기능: 개인 AI 채팅, 웹·문서 검색, 검색 출처, 대화 저장·복원, 테마 설정.
              <br />
              AI 연결 설정은 서버 관리자가 관리합니다. 데모 메시지는 저장하거나 AI에 전송하지 않습니다.
            </p>
            {extraSettings}
          </section>
        )}</AppDialog>}
      </main>
    </div>
  );
}
