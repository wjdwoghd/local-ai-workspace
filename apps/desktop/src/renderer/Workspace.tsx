import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { WORKSPACE_LIMITS, type WorkspaceEntry, type WorkspaceFile, type WorkspaceInfo } from '../../../../packages/shared-types/workspace';
import { WorkspaceEditor } from './WorkspaceEditor';
import { AgentPanel } from './AgentPanel';
import { setWorkspaceGuard } from './workspace-guard';
import { applyWorkspaceEdits } from '../../../../packages/shared-types/workspace-text';

const api = window.desktop.workspace;
const normalized = (text: string) => text.replace(/\r\n|\r/g, '\n');
const errorMessage = (error: unknown) => (error as Error).message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || '작업을 완료하지 못했습니다.';
type Tab = { file: WorkspaceFile; text: string; disk?: WorkspaceFile | null; unavailable?: string };
const modified = (tab: Tab) => normalized(tab.text) !== normalized(tab.file.text);
type Choice = { title: string; resolve: (value: 'save' | 'discard' | 'cancel') => void };

export function Workspace() {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const current = useRef(info); current.current = info;
  const [tabs, setTabs] = useState<Tab[]>([]); const latest = useRef(tabs);
  const updateTabs = (update: (items: Tab[]) => Tab[]) => { latest.current = update(latest.current); setTabs(latest.current); };
  const [active, setActive] = useState(''); const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({});
  const expanded = useRef(new Set(['']));
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<Choice>(); const pendingChoice = useRef<Choice | undefined>(undefined);
  const [diff, setDiff] = useState<'saved' | 'disk' | null>(null);
  const terminalHost = useRef<HTMLDivElement>(null); const term = useRef<Terminal | undefined>(undefined); const fit = useRef<FitAddon | undefined>(undefined);
  const terminalId = useRef(''); const [terminalStatus, setTerminalStatus] = useState('터미널을 시작하세요.');
  const fileRefresh = useRef(new Map<string, number>());
  const locked = useRef(false);
  const valid = (id: string) => current.current?.id === id;
  const fail = (error: unknown) => setMessage(errorMessage(error));
  async function loadTree(id: string, path: string) {
    try { const entries = await api.list(id, path); if (valid(id)) setTree(old => ({ ...old, [path]: entries })); }
    catch (error) { if (valid(id)) { setTree(old => ({ ...old, [path]: [] })); fail(error); } }
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
        terminalId.current = ''; term.current?.reset(); setTerminalStatus('터미널이 정리되었습니다.');
        pendingChoice.current?.resolve('cancel'); pendingChoice.current = undefined; setChoice(undefined);
      } else if (event.type === 'lost') { setMessage(event.message); terminalId.current = ''; setTerminalStatus('연결이 끊겨 터미널이 정리되었습니다.'); }
      else if (event.type === 'close-request') void handlers.current.guard().then(ok => { if (ok && valid(event.id)) void api.closeWindow(event.id).catch(fail); });
      else if (event.type === 'output') { if (terminalId.current === event.terminal && term.current) { term.current.write(event.data); term.current.options.disableStdin = false; setTerminalStatus('실행 중'); } }
      else if (event.type === 'exit') { if (terminalId.current === event.terminal) { terminalId.current = ''; if (term.current) term.current.options.disableStdin = true; setTerminalStatus(`종료 코드: ${event.code}`); } }
      else if (event.type === 'change') {
        void handlers.current.loadTree(event.id, event.directory);
        for (const tab of latest.current.filter(t => t.file.path.slice(0, Math.max(0, t.file.path.lastIndexOf('/'))) === event.directory)) {
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
    const terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontSize: 13, disableStdin: true });
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
    return () => { off(); observer.disconnect(); input.dispose(); terminal.dispose(); pendingChoice.current?.resolve('cancel'); setWorkspaceGuard(async () => true); };
  }, []);
  const isDirty = tabs.some(modified);
  useEffect(() => { if (info) void api.dirty(info.id, isDirty).catch(fail); }, [info?.id, isDirty]);
  async function openProject() {
    if (!await guard()) return;
    setBusy(true);
    try {
      const opened = await api.pick();
      if (!opened) return;
      current.current = opened; setInfo(opened); updateTabs(() => []); setActive(''); setTree({}); expanded.current = new Set(['']); setDiff(null); setMessage('');
      term.current?.reset(); terminalId.current = ''; setTerminalStatus('터미널을 시작하세요.');
      await loadTree(opened.id, '');
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function openFile(path: string) {
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
  function renderDirectory(path: string): React.ReactNode {
    return <ul>{(Object.hasOwn(tree, path) ? tree[path] : []).map(entry => <li key={entry.path}>
      <button disabled={entry.blocked || busy} title={entry.blocked ? '링크 또는 지원하지 않는 경로입니다.' : entry.path} aria-current={active === entry.path ? 'true' : undefined} aria-expanded={entry.directory ? expanded.current.has(entry.path) : undefined} onClick={() => {
        if (!entry.directory) { void openFile(entry.path); return; }
        if (expanded.current.has(entry.path)) { expanded.current.delete(entry.path); setTree(old => ({ ...old })); }
        else { expanded.current.add(entry.path); void loadTree(info!.id, entry.path); }
      }}>{entry.directory ? expanded.current.has(entry.path) ? '▾ 📁' : '▸ 📁' : '▧'} {entry.name}{entry.blocked ? ' (차단)' : ''}</button>
      {entry.directory && expanded.current.has(entry.path) && renderDirectory(entry.path)}
    </li>)}</ul>;
  }
  const tab = tabs.find(t => t.file.path === active);
  return <section className="workspace-page" aria-label="로컬 개발 환경">
    <div className="workspace-toolbar"><button disabled={busy} onClick={() => void openProject()}>{info ? '프로젝트 전환' : '프로젝트 열기'}</button>
      {info && <><strong>{info.name}</strong><small title={info.root}>{info.root}</small><button disabled={busy} onClick={async () => { if (await guard()) await api.close(info.id).catch(fail); }}>프로젝트 닫기</button><button disabled={busy} onClick={() => { for (const directory of expanded.current) void loadTree(info.id, directory); }}>새로고침</button></>}
    </div>
    {message && <p className="workspace-notice" role="status">{message}</p>}
    {info && <AgentPanel key={info.id} id={info.id} paths={tabs.map(t => t.file.path)} dirty={isDirty} />}
    <div className="workspace-body"><aside className="file-tree" aria-label="파일 탐색기">{info ? renderDirectory('') : <p>프로젝트 폴더를 선택하세요.<br />파일과 터미널 출력은 자동 업로드되지 않습니다.</p>}</aside>
      <div className="workspace-content"><div className="file-tabs" role="tablist" aria-label="열린 파일">{tabs.map(t => <div key={t.file.path}><button role="tab" aria-selected={active === t.file.path} onClick={() => { setActive(t.file.path); setDiff(null); }}>{t.file.path}{modified(t) ? ' ●' : ''}{t.disk !== undefined ? ' ⚠' : ''}</button><button disabled={busy} aria-label={`닫기 ${t.file.path}`} onClick={() => void closeTab(t.file.path)}>×</button></div>)}</div>
        {tab ? <><div className="file-actions"><span>{tab.file.bom ? 'UTF-8 BOM' : 'UTF-8'} · {tab.file.eol}</span><button disabled={busy} onClick={() => void saveTab(tab)}>저장 Ctrl+S</button><button onClick={() => setDiff(diff === 'saved' ? null : 'saved')}>저장본 비교</button>
          {tab.disk !== undefined && <><strong>외부 변경 충돌</strong><button onClick={() => setDiff('disk')}>디스크 비교</button><button disabled={busy} onClick={async () => {
            if (modified(tab) && !await guard(tab.file.path)) return;
            const id = current.current?.id; if (!id) return;
            try { const file = await api.read(id, tab.file.path); if (valid(id)) updateTabs(items => items.map(t => t.file.path === file.path ? { file, text: file.text } : t)); } catch (error) { fail(error); }
          }}>다시 읽기</button><button disabled={busy || !tab.disk || diff !== 'disk'} onClick={() => void saveTab(tab, true)}>명시적 덮어쓰기</button></>}
        </div>{tab.unavailable && <p role="alert">{tab.unavailable} 편집 내용은 유지됩니다.</p>}
        {diff && <div className="diff-label">왼쪽: {diff === 'saved' ? '마지막으로 읽거나 저장한 원본' : tab.disk ? '마지막 감지한 디스크 버전 (저장 시 재검사)' : '디스크 파일 없음/읽기 불가'} / 오른쪽: 현재 편집 내용 <button onClick={() => setDiff(null)}>비교 닫기</button></div>}
        <WorkspaceEditor key={`${info?.id}:${active}`} path={active} text={normalized(tab.text)} original={diff ? normalized(diff === 'saved' ? tab.file.text : tab.disk?.text || '') : undefined} readOnly={busy} onChange={(text, edits) => updateTabs(items => items.map(t => t.file.path === active && normalized(t.text) !== text ? { ...t, text: applyWorkspaceEdits(t.text, edits) } : t))} onSave={() => { if (!locked.current) void saveTab(latest.current.find(t => t.file.path === active)!); }} />
        </> : <div className="editor-empty">파일을 선택하면 Monaco 편집기로 열립니다.</div>}
        <div className="terminal-toolbar"><strong>PowerShell 터미널</strong><span>{terminalStatus}</span><button disabled={!info || busy} onClick={async () => {
          const id = current.current?.id; if (!id) return;
          try { term.current?.reset(); if (term.current) term.current.options.disableStdin = true; const terminal = await api.terminalStart(id); if (valid(id)) { terminalId.current = terminal; setTerminalStatus('셸 시작 중…'); fit.current?.fit(); await api.terminalResize(id, terminal, Math.max(2, Math.min(500, term.current!.cols)), Math.max(2, Math.min(200, term.current!.rows))); term.current?.focus(); } } catch (error) { fail(error); }
        }}>터미널 시작·재시작</button><button disabled={!info} onClick={() => { if (info) void api.terminalStop(info.id).then(() => { terminalId.current = ''; setTerminalStatus('사용자가 종료했습니다.'); }).catch(fail); }}>터미널 종료</button></div>
        <p className="terminal-warning">터미널은 OS 사용자 권한으로 실행되며 프로젝트 밖에도 접근합니다. 입력한 명령을 직접 실행합니다.</p>
        <div className="workspace-terminal" ref={terminalHost} aria-label="대화형 터미널" />
      </div></div>
    {choice && createPortal(<div className="workspace-modal-backdrop"><div className="workspace-modal" role="dialog" aria-modal="true" aria-label="저장하지 않은 변경"><h2>{choice.title}</h2><p>저장 실패나 외부 충돌이 있으면 작업을 중단하고 편집 내용을 유지합니다.</p>{(['save', 'discard', 'cancel'] as const).map((value, i) => <button key={value} autoFocus={value === 'cancel'} onClick={() => { pendingChoice.current = undefined; setChoice(undefined); choice.resolve(value); }}>{['저장', '폐기', '취소'][i]}</button>)}</div></div>, document.body)}
  </section>;
}
