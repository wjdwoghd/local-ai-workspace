import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { WORKSPACE_LIMITS, type ShellProfile, type WorkspaceEntry, type WorkspaceFile, type WorkspaceInfo, type WorkspaceEvent } from '../../../../packages/shared-types/workspace';
import { WorkspaceEditor } from './WorkspaceEditor';
import { WorkbenchChat } from './WorkbenchChat';
import { FileIcon } from './FileIcon';
import { Explorer,type ExplorerFocus,type ExplorerMutation } from './Explorer';
import { ResizeHandle } from './ResizeHandle';
import materialLicense from './assets/material/LICENSE?raw';
import d2codingLicense from './assets/d2coding/OFL.txt?raw';
import { GitPanel, type GitOpenRequest } from './GitPanel';
import type { GitView, GitFileDiff } from '../../../../packages/shared-types/git';
import { setWorkspaceGuard } from './workspace-guard';
import { applyWorkspaceEdits } from '../../../../packages/shared-types/workspace-text';

const api = window.desktop.workspace;
const normalized = (text: string) => text.replace(/\r\n|\r/g, '\n');
const errorMessage = (error: unknown) => (error as Error).message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || '작업을 완료하지 못했습니다.';
type Tab = { file: WorkspaceFile; text: string; disk?: WorkspaceFile | null; unavailable?: string };
const modified = (tab: Tab) => normalized(tab.text) !== normalized(tab.file.text);
type Choice = { title: string; resolve: (value: 'save' | 'discard' | 'cancel') => void };

export function Workspace({ local = false, visible=true,reasoningScope='' }: { local?: boolean; visible?:boolean;reasoningScope?:string }) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const current = useRef(info); current.current = info;
  const [tabs, setTabs] = useState<Tab[]>([]); const latest = useRef(tabs);
  const updateTabs = (update: (items: Tab[]) => Tab[]) => { latest.current = update(latest.current); setTabs(latest.current); };
  const [active, setActive] = useState(''); const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({});
  const expanded = useRef(new Set(['']));
  const treeRefresh=useRef(new Map<string,number>());
  const treeSerial=useRef(0);
  const [explorerFocus,setExplorerFocus]=useState<ExplorerFocus>();
  function focusExplorer(mode:'files'|'text'){setSidebar('explorer');setShowSidebar(true);setExplorerFocus(old=>({mode,serial:(old?.serial||0)+1}));}
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState<'explorer' | 'source' | 'settings'>('explorer');
  const [showSidebar, setShowSidebar] = useState(true), [showChat, setShowChat] = useState(true), [showTerminal, setShowTerminal] = useState(true);
  const [sideWidth, setSideWidth] = useState(230), [chatRatio, setChatRatio] = useState(.28), [terminalHeight, setTerminalHeight] = useState(230);
  const [shell, setShell] = useState<ShellProfile>('powershell');
  const [chatFocus, setChatFocus] = useState(0);
  const [gitView,setGitView]=useState<GitView>(),[gitDiff,setGitDiff]=useState<GitFileDiff>(),[gitOpen,setGitOpen]=useState<GitOpenRequest>();
  useEffect(()=>{setGitView(undefined);setGitDiff(undefined);setGitOpen(undefined);},[info?.id]);
  const openGit=(kind:GitOpenRequest['kind'])=>setGitOpen(old=>({kind,workspace:info?.id,serial:(old?.serial||0)+1}));
  const layoutHost = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ width: 1200, height: 600 });
  useEffect(() => { const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(layoutHost.current!); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if(!visible)return;if(e.ctrlKey&&(e.code==='KeyP'||e.shiftKey&&e.code==='KeyF')){e.preventDefault();focusExplorer(e.code==='KeyP'?'files':'text');}if(e.ctrlKey&&e.shiftKey&&e.code==='KeyG'){e.preventDefault();setSidebar('source');setShowSidebar(true);setSideWidth(width=>Math.max(width,320));}if (e.ctrlKey && e.code === 'Backquote') { e.preventDefault(); setShowTerminal(v => !v); } if (e.ctrlKey && e.code === 'KeyB') { e.preventDefault(); setShowSidebar(v => !v); } };
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
  }, [visible]);
  const [choice, setChoice] = useState<Choice>(); const pendingChoice = useRef<Choice | undefined>(undefined);
  const [diff, setDiff] = useState<'saved' | 'disk' | null>(null);
  const terminalHost = useRef<HTMLDivElement>(null); const term = useRef<Terminal | undefined>(undefined); const fit = useRef<FitAddon | undefined>(undefined);
  const terminalId = useRef(''); const [terminalStatus, setTerminalStatus] = useState('터미널을 시작하세요.');
  const [terminalConnected, setTerminalConnected] = useState(false);
  const autoStarted = useRef('');
  type TerminalEvent = Extract<WorkspaceEvent, { type: 'output' | 'exit' }>;
  const terminalStart = useRef<{ id: string; events: TerminalEvent[] } | undefined>(undefined);
  const [terminalStarting, setTerminalStarting] = useState(false);
  function terminalEvent(event: TerminalEvent) {
    if (terminalId.current !== event.terminal || !term.current) return;
    if (event.type === 'output') {
      term.current.write(event.data); term.current.options.disableStdin = false; setTerminalStatus('실행 중');
    } else {
      terminalId.current = ''; setTerminalConnected(false); term.current.options.disableStdin = true; setTerminalStatus(`종료 코드: ${event.code}`);
    }
  }
  async function startTerminal(focus = true) {
    const id = current.current?.id;
    if (!id || terminalStart.current) return;
    const start = { id, events: [] as TerminalEvent[] };
    terminalStart.current = start; setTerminalStarting(true); setTerminalStatus('터미널 시작 중…');
    terminalId.current = ''; setTerminalConnected(false);
    term.current?.reset();
    if (term.current) term.current.options.disableStdin = true;
    try {
      const terminal = await api.terminalStart(id, shell);
      if (!valid(id) || terminalStart.current !== start) return;
      terminalId.current = terminal;
      setTerminalConnected(true);
      if (term.current) term.current.options.disableStdin = false;
      setTerminalStatus(`${shell === 'powershell' ? 'PowerShell' : 'Git Bash'} 실행 중`);
      // PTY events can precede the invoke reply. Replay after assigning the ID,
      // without resetting away the shell prompt or its terminal handshake.
      terminalStart.current = undefined;
      for (const event of start.events) terminalEvent(event);
      fit.current?.fit();
      if (term.current && terminalId.current === terminal) {
        await api.terminalResize(id, terminal, Math.max(2, Math.min(500, term.current.cols)), Math.max(2, Math.min(200, term.current.rows)));
        if (focus) term.current.focus();
      }
    } catch (error) {
      if (valid(id)) { fail(error); setTerminalStatus('터미널 시작 실패'); setTerminalConnected(false); }
    } finally {
      if (terminalStart.current === start) terminalStart.current = undefined;
      setTerminalStarting(false);
    }
  }
  const fileRefresh = useRef(new Map<string, number>());
  const locked = useRef(false);
  const valid = (id: string) => current.current?.id === id;
  const fail = (error: unknown) => setMessage(errorMessage(error));
  async function loadTree(id: string, path: string) {
    const ticket=++treeSerial.current;treeRefresh.current.set(path,ticket);
    try { const entries = await api.list(id, path); if (valid(id)) setTree(old => {
      if(treeRefresh.current.get(path)!==ticket)return old;
      const next={...old,[path]:entries},removed=(Object.hasOwn(old,path)?old[path]:[]).filter(e=>e.directory&&!entries.some(n=>n.path===e.path&&n.directory));
      for(const directory of Object.keys(next))if(removed.some(e=>directory===e.path||directory.startsWith(e.path+'/'))){delete next[directory];expanded.current.delete(directory);treeRefresh.current.set(directory,++treeSerial.current);}
      return next;
    }); }
    catch (error) { if (valid(id)&&treeRefresh.current.get(path)===ticket) { setTree(old => ({ ...old, [path]: [] })); if(!path)fail(error); } }
  }
  function ask(title: string) {
    return new Promise<'save' | 'discard' | 'cancel'>(resolve => {
      const next = { title, resolve }; pendingChoice.current = next; setChoice(next);
    });
  }
  async function saveTab(tab: Tab, overwrite = false): Promise<boolean> {
    const workspace = current.current; if (!workspace) return false;
    const version = overwrite ? tab.disk?.version : tab.file.version;
    if (!version) { setMessage('삭제된 파일은 덮어쓸 수 없습니다. 편집 내용을 복사해 보관하세요.'); return false; }
    try {
      const result = await api.save(workspace.id, tab.file.path, tab.text, version, overwrite);
      if (!valid(workspace.id)) return false;
      if (result.conflict) {
        updateTabs(items => items.map(t => t.file.path === tab.file.path ? { ...t, disk: result.disk, unavailable: result.disk ? undefined : '파일이 삭제되었습니다.' } : t));
        setActive(tab.file.path); setDiff('disk'); setMessage('디스크가 변경되었습니다. 비교 후 다시 읽기 또는 명시적 덮어쓰기를 선택하세요.'); return false;
      }
      updateTabs(items => items.map(t => t.file.path === tab.file.path ? { ...t, file: result.file, disk: undefined, unavailable: undefined } : t));
      setMessage('저장했습니다.'); return true;
    } catch (error) { if (valid(workspace.id)) fail(error); return false; }
  }
  async function guard(path?: string) {
    if (locked.current) return false;
    locked.current = true; setBusy(true);
    try {
      for (const tab of latest.current.filter(t => (!path || t.file.path === path) && modified(t))) {
        const response = await ask(`${tab.file.path}의 변경 내용을 저장할까요?`);
        if (response === 'cancel') return false;
        if (response === 'save' && !await saveTab(tab)) { window.dispatchEvent(new Event('workspace-focus')); return false; }
      }
      return true;
    } finally { locked.current = false; setBusy(false); }
  }
  const handlers = useRef({ guard, saveTab, loadTree }); handlers.current = { guard, saveTab, loadTree };
  useEffect(() => {
    setWorkspaceGuard(() => handlers.current.guard());
    const off = api.onEvent(event => {
      if (!valid(event.id)) return;
      if (event.type === 'reset') {
        current.current = null; setInfo(null); updateTabs(() => []); setTree({}); setActive(''); setDiff(null);
        fileRefresh.current.clear();
        terminalId.current = ''; setTerminalConnected(false); term.current?.reset(); setTerminalStatus('터미널이 정리되었습니다.');
        pendingChoice.current?.resolve('cancel'); pendingChoice.current = undefined; setChoice(undefined);
      } else if (event.type === 'lost') { setMessage(event.message); terminalId.current = ''; setTerminalConnected(false); setTerminalStatus('연결이 끊겨 터미널이 정리되었습니다.'); }
      else if (event.type === 'close-request') void handlers.current.guard().then(ok => { if (ok && valid(event.id)) void api.closeWindow(event.id).catch(fail); });
      else if (event.type === 'output' || event.type === 'exit') {
        const start = terminalStart.current;
        if (start?.id === event.id) {
          if (start.events.length >= 64) start.events.shift();
          start.events.push(event);
        } else terminalEvent(event);
      }
      else if (event.type === 'change') {
        if(expanded.current.has(event.directory))void handlers.current.loadTree(event.id, event.directory);
        for (const tab of latest.current.filter(t => !event.directory||t.file.path.startsWith(event.directory+'/'))) {
          const baseline = tab.file.version;
          const refresh = (fileRefresh.current.get(tab.file.path) || 0) + 1;
          fileRefresh.current.set(tab.file.path, refresh);
          void api.read(event.id, tab.file.path).then(disk => {
            if (!valid(event.id) || fileRefresh.current.get(tab.file.path) !== refresh) return;
            updateTabs(items => items.map(t => {
              if (t.file.path !== tab.file.path || t.file.version !== baseline || disk.version === t.file.version) return t;
              return modified(t) ? { ...t, disk, unavailable: undefined } : { file: disk, text: disk.text };
            }));
          }).catch(error => { if (valid(event.id) && fileRefresh.current.get(tab.file.path) === refresh) updateTabs(items => items.map(t => t.file.path === tab.file.path && t.file.version === baseline ? { ...t, disk: null, unavailable: errorMessage(error) } : t)); });
        }
      }
    });
    const terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontFamily:'D2Coding, monospace',fontSize:14, minimumContrastRatio:4.5, disableStdin: true,
      theme:{background:'#10141C',foreground:'#E6EDF7',cursor:'#F5F8FF',selectionBackground:'#5076A766',black:'#202631',red:'#FF8585',green:'#A8E580',yellow:'#F3D574',blue:'#83B9FF',magenta:'#DCA0FF',cyan:'#70DFEC',white:'#E6EDF7',brightBlack:'#9CAEC5',brightRed:'#FFA2A2',brightGreen:'#C0F59B',brightYellow:'#FFE995',brightBlue:'#A9D0FF',brightMagenta:'#EDBDFF',brightCyan:'#9AF2FA',brightWhite:'#FFFFFF'},
    });
    const addon = new FitAddon(); terminal.loadAddon(addon); terminal.open(terminalHost.current!); term.current = terminal; fit.current = addon;
    const input = terminal.onData(data => {
      const workspace = current.current; const terminal = terminalId.current;
      if (workspace && terminal) for (let i = 0; i < data.length; i += 8192) void api.terminalWrite(workspace.id, terminal, data.slice(i, i + 8192)).catch(fail);
    });
    const resize = () => {
      if (!terminalHost.current?.offsetWidth) return;
      addon.fit();
      if (current.current && terminalId.current) void api.terminalResize(current.current.id, terminalId.current, Math.max(2, Math.min(500, terminal.cols)), Math.max(2, Math.min(200, terminal.rows))).catch(fail);
    };
    const observer = new ResizeObserver(resize); observer.observe(terminalHost.current!);
    let disposed=false;
    void document.fonts.load('14px D2Coding').then(()=>{if(!disposed){terminal.options.fontFamily='D2Coding, monospace';resize();terminal.refresh(0,terminal.rows-1);}});
    return () => { disposed=true;off(); observer.disconnect(); input.dispose(); terminal.dispose(); pendingChoice.current?.resolve('cancel'); setWorkspaceGuard(async () => true); };
  }, []);
  useEffect(()=>{
    if(!visible||!info)return;let scanning=false;
    const refresh=async()=>{if(scanning||locked.current)return;scanning=true;try{for(const directory of [...expanded.current]){if(!valid(info.id))break;await handlers.current.loadTree(info.id,directory);}}finally{scanning=false;}};
    const timer=setInterval(()=>void refresh(),5000),focus=()=>void refresh();window.addEventListener('focus',focus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};
  },[visible,info?.id]);
  const isDirty = tabs.some(modified);
  useEffect(() => {
    if (visible && showTerminal && info && autoStarted.current !== info.id) {
      autoStarted.current = info.id; void startTerminal(false);
    }
  }, [info?.id, visible, showTerminal]);
  useEffect(() => {
    if (!visible || !showTerminal) return;
    const frame = requestAnimationFrame(() => {
      fit.current?.fit();
      if (term.current) term.current.refresh(0, term.current.rows - 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, showTerminal]);
  useEffect(() => { if (info) void api.dirty(info.id, isDirty).catch(fail); }, [info?.id, isDirty]);
  async function openProject(home = false) {
    if (!await guard()) return;
    setBusy(true);
    try {
      const opened = home ? await api.home() : await api.pick();
      if (!opened) return;
      current.current = opened; setInfo(opened); updateTabs(() => []); setActive(''); setTree({});treeRefresh.current.clear(); expanded.current = new Set(['']); setDiff(null); setMessage('');
      term.current?.reset(); terminalId.current = ''; setTerminalConnected(false); setTerminalStatus('터미널을 시작하세요.');
      await loadTree(opened.id, '');
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function openFile(path: string) {
    setGitDiff(undefined);
    if (!info || busy) return;
    if (latest.current.some(t => t.file.path === path)) { setActive(path); setDiff(null); return; }
    if (latest.current.length >= WORKSPACE_LIMITS.tabs) { setMessage('열린 파일은 최대 20개입니다. 탭을 닫아 주세요.'); return; }
    const id = info.id; setBusy(true);
    try {
      const file = await api.read(id, path);
      if (!valid(id)) return;
      updateTabs(items => [...items, { file, text: file.text }]); setActive(path); setDiff(null); setMessage('');
    } catch (error) { if (valid(id)) fail(error); } finally { setBusy(false); }
  }
  async function closeTab(path: string) {
    if (!await guard(path)) return;
    updateTabs(items => items.filter(t => t.file.path !== path));
    if (active === path) setActive(latest.current[0]?.file.path || '');
    setDiff(null);
  }
  function toggleDirectory(path:string){
    if(expanded.current.has(path)){expanded.current.delete(path);setTree(old=>({...old}));}
    else if(info){expanded.current.add(path);void loadTree(info.id,path);}
  }
  async function revealFile(path:string){
    if(!info)return;const parts=path.split('/');parts.pop();let directory='';
    for(const part of parts){directory=directory?directory+'/'+part:part;expanded.current.add(directory);await loadTree(info.id,directory);}
    await openFile(path);
  }
  async function mutateExplorer(kind:ExplorerMutation,path:string,target?:string){
    if(!info||busy||locked.current)throw new Error('다른 파일 작업이 진행 중입니다.');
    const id=info.id,under=(candidate:string)=>candidate===path||candidate.startsWith(path+'/');
    if((kind==='rename'||kind==='trash')&&latest.current.some(modified))throw new Error('편집 중인 내용을 저장한 뒤 진행하세요.');
    locked.current=true;setBusy(true);
    try{
      await api.dirty(id,latest.current.some(modified));
      if(kind==='file'||kind==='directory'){
        await api.create(id,target!,kind==='directory');if(!valid(id))return;
        const parent=target!.split('/').slice(0,-1).join('/');expanded.current.add(parent);await loadTree(id,parent);
        if(kind==='file'&&latest.current.length<WORKSPACE_LIMITS.tabs){const file=await api.read(id,target!);if(valid(id)){updateTabs(items=>[...items,{file,text:file.text}]);setActive(target!);}}
      }else if(kind==='rename'){
        const beforeExpanded=[...expanded.current];
        await api.rename(id,path,target!);if(!valid(id))return;
        const moved=new Map<string,WorkspaceFile>();for(const tab of latest.current.filter(t=>under(t.file.path)))moved.set(tab.file.path,await api.read(id,target!+tab.file.path.slice(path.length)));
        if(!valid(id))return;
        updateTabs(items=>items.map(t=>moved.has(t.file.path)?{file:moved.get(t.file.path)!,text:moved.get(t.file.path)!.text}:t));
        if(under(active))setActive(target!+active.slice(path.length));
        expanded.current=new Set(beforeExpanded.map(p=>under(p)?target!+p.slice(path.length):p));setTree({});treeRefresh.current.clear();
        for(const directory of [...expanded.current].sort((a,b)=>a.length-b.length))await loadTree(id,directory);
      }else{
        await api.trash(id,path);if(!valid(id))return;
        updateTabs(items=>items.filter(t=>!under(t.file.path)));if(under(active))setActive(latest.current[0]?.file.path||'');
        for(const directory of [...expanded.current])if(under(directory))expanded.current.delete(directory);
      }
      if(valid(id)){await loadTree(id,'');setGitDiff(undefined);setDiff(null);setMessage(kind==='trash'?'휴지통으로 이동했습니다.':kind==='rename'?'이름을 변경했습니다.':'생성했습니다.');}
    }finally{locked.current=false;setBusy(false);}
  }
  const tab = tabs.find(t => t.file.path === active);
  const actualSide = Math.min(sideWidth, Math.max(150, size.width * .3));
  const actualChat = Math.min(Math.max(240,size.width * chatRatio), Math.max(240, size.width * .4));
  // PSReadLine needs enough visible rows to redraw a wrapped prompt and command.
  const actualTerminal = Math.max(200, Math.min(terminalHeight, Math.max(200, size.height - 200)));
  const selectSidebar = (next: typeof sidebar) => { setShowSidebar(sidebar !== next || !showSidebar); setSidebar(next);if(next==='source')setSideWidth(width=>Math.max(width,320)); };
  return <section className="workspace-page vscode-workbench" aria-label="로컬 개발 환경">
    <div className="workspace-toolbar"><button disabled={busy} onClick={() => void openProject()}>{info ? '프로젝트 전환' : '프로젝트 열기'}</button>
      {local && <button disabled={busy} onClick={() => void openProject(true)}>내 작업 폴더 열기</button>}
      {info && <><strong>{info.name}</strong><small title={info.root}>{info.root}</small><button disabled={busy} onClick={async () => { if (await guard()) await api.close(info.id).catch(fail); }}>프로젝트 닫기</button><button disabled={busy} onClick={() => { for (const directory of expanded.current) void loadTree(info.id, directory); }}>새로고침</button></>}
    </div>
    {message && <p className="workspace-notice" role="status">{message}</p>}
    <div className="workbench-layout" ref={layoutHost}>
      <nav className="activity-bar" aria-label="활동 표시줄">
        <button title="탐색기 (Ctrl+B)" aria-label="탐색기" aria-pressed={showSidebar && sidebar === 'explorer'} onClick={() => selectSidebar('explorer')}><span className="codicon codicon-files" /></button>
        <button title="파일 내용 검색 (Ctrl+Shift+F)" aria-label="프로젝트 검색" onClick={() => focusExplorer('text')}><span className="codicon codicon-search" /></button>
        <button title="소스 제어 (Ctrl+Shift+G)" aria-label="소스 제어" aria-pressed={showSidebar && sidebar === 'source'} onClick={() => selectSidebar('source')}><span className="codicon codicon-source-control" /></button>
        <button title="챗봇" aria-label="챗봇 표시" aria-pressed={showChat} onClick={() => setShowChat(!showChat)}><span className="codicon codicon-comment-discussion" /></button>
        <button title="터미널" aria-label="터미널 표시" aria-pressed={showTerminal} onClick={() => setShowTerminal(!showTerminal)}><span className="codicon codicon-terminal" /></button>
        <button className="activity-settings" title="설정" aria-label="작업 공간 설정" aria-pressed={showSidebar && sidebar === 'settings'} onClick={() => selectSidebar('settings')}><span className="codicon codicon-settings-gear" /></button>
      </nav>
      <div className="workbench-sidebar" hidden={!showSidebar} style={{ width: actualSide }}>
        <header className="pane-heading"><strong>{sidebar === 'source' ? 'SOURCE CONTROL' : sidebar === 'settings' ? 'SETTINGS' : 'EXPLORER'}</strong><button aria-label="사이드바 닫기" onClick={() => setShowSidebar(false)}>×</button></header>
        <Explorer key={info?.id||'empty-explorer'} info={info} tree={tree} expanded={expanded.current} active={active} busy={busy} dirty={isDirty} hidden={sidebar!=='explorer'} git={gitView} focusRequest={explorerFocus} onToggle={toggleDirectory} onOpen={path=>void openFile(path)} onReveal={path=>void revealFile(path)} onRefresh={()=>{if(info)for(const directory of expanded.current)void loadTree(info.id,directory);}} onMutate={mutateExplorer} onGit={(operation,paths)=>setGitOpen(old=>({kind:'history',workspace:info?.id,serial:(old?.serial||0)+1,fileOperation:operation,paths}))}/>
        <div className="source-pane" hidden={sidebar !== 'source'}>{info ? <GitPanel key={`git:${info.id}`} id={info.id} dirty={isDirty} visible={visible} onView={setGitView} onDiff={setGitDiff} openRequest={gitOpen} onNotice={setMessage} /> : <p>Git 저장소를 여세요.</p>}</div>
        {sidebar === 'settings' && <div className="workbench-settings"><h3>작업 공간</h3><p>{local ? 'DB 없는 로컬 프로필' : '인증된 서버 연결'}</p><p>파일 아이콘: Material Icon Theme</p><button onClick={() => { setSideWidth(230); setChatRatio(.28); setTerminalHeight(230); setShowChat(true); setShowTerminal(true); }}>레이아웃 초기화</button><p>경계선을 드래그하거나 방향키로 크기를 조절하세요.</p><details><summary>아이콘 라이선스 (MIT)</summary><pre className="icon-license">{materialLicense}</pre></details><details><summary>D2Coding 글꼴 라이선스 (OFL)</summary><pre className="icon-license">{d2codingLicense}</pre></details></div>}
      </div>
      {showSidebar && <ResizeHandle label="사이드바 크기" value={actualSide} min={150} max={Math.max(150, size.width * .3)} onChange={setSideWidth} />}
      <div className="workspace-content"><div className="editor-group"><div className="file-tabs" role="tablist" aria-label="열린 파일">{tabs.map(t => <div key={t.file.path}><button role="tab" aria-selected={active === t.file.path} onClick={() => { setActive(t.file.path); setDiff(null); setGitDiff(undefined); }}><FileIcon name={t.file.path} />{t.file.path}{modified(t) ? ' ●' : ''}{t.disk !== undefined ? ' ⚠' : ''}</button><button disabled={busy} aria-label={`닫기 ${t.file.path}`} onClick={() => void closeTab(t.file.path)}>×</button></div>)}</div>
        {gitDiff?<><div className="git-preview-title"><strong>{gitDiff.path}</strong><small>{gitDiff.label}</small><button onClick={()=>setGitDiff(undefined)}>Git 비교 닫기</button></div><WorkspaceEditor key={`git-diff:${info?.id}:${gitDiff.path}:${gitDiff.label}`} path={gitDiff.path} text={gitDiff.modified} original={gitDiff.original} readOnly onChange={()=>{}} onSave={()=>{}}/></>:tab ? <><div className="file-actions"><span>{tab.file.bom ? 'UTF-8 BOM' : 'UTF-8'} · {tab.file.eol}</span><button disabled={busy} onClick={() => void saveTab(tab)}>저장 Ctrl+S</button><button onClick={() => setDiff(diff === 'saved' ? null : 'saved')}>저장본 비교</button>
          {tab.disk !== undefined && <><strong>외부 변경 충돌</strong><button onClick={() => setDiff('disk')}>디스크 비교</button><button disabled={busy} onClick={async () => {
            if (modified(tab) && !await guard(tab.file.path)) return;
            const id = current.current?.id; if (!id) return;
            try { const file = await api.read(id, tab.file.path); if (valid(id)) updateTabs(items => items.map(t => t.file.path === file.path ? { file, text: file.text } : t)); } catch (error) { fail(error); }
          }}>다시 읽기</button><button disabled={busy || !tab.disk || diff !== 'disk'} onClick={() => void saveTab(tab, true)}>명시적 덮어쓰기</button></>}
        </div>{tab.unavailable && <p role="alert">{tab.unavailable} 편집 내용은 유지됩니다.</p>}
        {diff && <div className="diff-label">왼쪽: {diff === 'saved' ? '마지막으로 읽거나 저장한 원본' : tab.disk ? '마지막 감지한 디스크 버전 (저장 시 재검사)' : '디스크 파일 없음/읽기 불가'} / 오른쪽: 현재 편집 내용 <button onClick={() => setDiff(null)}>비교 닫기</button></div>}
        <WorkspaceEditor key={`${info?.id}:${active}`} path={active} text={normalized(tab.text)} original={diff ? normalized(diff === 'saved' ? tab.file.text : tab.disk?.text || '') : undefined} readOnly={busy} onChange={(text, edits) => updateTabs(items => items.map(t => t.file.path === active && normalized(t.text) !== text ? { ...t, text: applyWorkspaceEdits(t.text, edits) } : t))} onSave={() => { if (!locked.current) void saveTab(latest.current.find(t => t.file.path === active)!); }} />
        </> : <div className="editor-empty"><span className="codicon codicon-code" aria-hidden="true" /><p>파일을 선택하면 Monaco 편집기로 열립니다.</p><small>탐색기에서 파일 열기 · Ctrl+S 저장 · Ctrl+` 터미널</small></div>}</div>
        {showTerminal && <ResizeHandle label="터미널 크기" axis="y" value={actualTerminal} min={200} max={Math.max(200, size.height - 200)} reverse onChange={setTerminalHeight} />}
        <section className="terminal-panel" hidden={!showTerminal} style={{ height: actualTerminal }} aria-label="하단 터미널">
        <div className="terminal-toolbar"><strong>TERMINAL</strong><label><span className="sr-only">셸 프로필</span><select aria-label="셸 프로필" value={shell} disabled={terminalStarting} onChange={e => setShell(e.target.value as ShellProfile)}><option value="powershell">PowerShell</option><option value="git-bash">Git Bash</option></select></label><span role="status">{terminalStatus}</span><button disabled={!info || busy || terminalStarting} onClick={() => void startTerminal()}>터미널 시작·재시작</button><button disabled={!info || terminalStarting} onClick={() => { if (info) void api.terminalStop(info.id).then(() => { terminalId.current = ''; if (term.current) term.current.options.disableStdin = true; setTerminalConnected(false); setTerminalStatus('사용자가 종료했습니다.'); }).catch(fail); }}>터미널 종료</button></div>
        <p className="terminal-warning">터미널은 OS 사용자 권한으로 실행되며 프로젝트 밖에도 접근합니다. 입력한 명령을 직접 실행합니다.</p>
        <div className="terminal-surface" onPointerDown={() => { if (terminalId.current) term.current?.focus(); }}>
          <div className="workspace-terminal" ref={terminalHost} aria-label="대화형 터미널" />
          {!terminalConnected && <div className="terminal-empty"><p>{terminalStarting ? 'PowerShell에 연결하고 있습니다…' : info ? '터미널이 연결되지 않았습니다.' : '프로젝트를 열면 터미널을 사용할 수 있습니다.'}</p><button disabled={busy || terminalStarting} onClick={() => { if (info) void startTerminal(); else void openProject(local); }}>{info ? '터미널 시작' : local ? '내 작업 폴더에서 터미널 시작' : '프로젝트 열고 터미널 시작'}</button></div>}
        </div>
        </section>
      </div>
      {showChat && <ResizeHandle label="챗봇 크기" value={actualChat} min={240} max={Math.max(240, size.width * .4)} reverse onChange={width=>setChatRatio(width/Math.max(1,size.width))} />}
      <div className="chat-pane" hidden={!showChat} style={{ width: actualChat }}><WorkbenchChat key={info?.id || 'empty'} info={info} local={local} paths={tabs.map(t => t.file.path)} dirty={isDirty} onOpen={path => void openFile(path)} focusRequest={chatFocus} reasoningScope={reasoningScope} workspaceBusy={busy}/></div>
    </div>
    <footer className="workbench-status" aria-label="Git 및 작업 공간 상태"><span className="codicon codicon-remote" />{gitView?<><button className="git-status-branch" aria-label="브랜치 선택" title={`현재 브랜치: ${gitView.branch||'분리된 HEAD'} · 브랜치 선택`} onClick={()=>openGit('branches')}>⑂ {gitView.branch||gitView.head.slice(0,7)||'첫 커밋 전'}{gitView.changes.length?'*':''}</button><button className="git-status-sync" aria-label="Git 동기화 상태" title={gitView.upstream?`${gitView.upstream} 기준 로컬 추적 상태`:'추적 브랜치 없음 · 원격 작업 열기'} onClick={()=>openGit('remote')}>{gitView.upstream?'↓'+gitView.behind+' ↑'+gitView.ahead:'↻ 원격'}</button><button className="git-status-history" aria-label="브랜치 이력" title="커밋 그래프와 브랜치 이력 열기" onClick={()=>openGit('history')}>◷ {gitView.head?`${gitView.head.slice(0,7)} · ${gitView.history.find(c=>c.id===gitView.head)?.subject||'커밋 이력'}`:'첫 커밋 전'}</button></>:<span>{info?'Git 저장소 없음':'프로젝트 없음'}</span>}<span className="status-spacer" /><span className="git-status-project" title={info?.root}>{info?.name}</span><span>{isDirty?'● 미저장':tab?`${tab.file.eol} · UTF-8 · ${active.split('.').pop()}`:'✓ 준비'}</span><span>{local?'로컬':'서버'}</span></footer>
    {choice && createPortal(<div className="workspace-modal-backdrop"><div className="workspace-modal" role="dialog" aria-modal="true" aria-label="저장하지 않은 변경"><h2>{choice.title}</h2><p>저장 실패나 외부 충돌이 있으면 작업을 중단하고 편집 내용을 유지합니다.</p>{(['save', 'discard', 'cancel'] as const).map((value, i) => <button key={value} autoFocus={value === 'cancel'} onClick={() => { pendingChoice.current = undefined; setChoice(undefined); choice.resolve(value); }}>{['저장', '폐기', '취소'][i]}</button>)}</div></div>, document.body)}
  </section>;
}
