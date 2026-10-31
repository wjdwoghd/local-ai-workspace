import { useEffect, useRef, useState } from 'react';
import type { AgentMode, AgentState, AgentView } from '../../../../packages/shared-types/agent';
import { WorkspaceEditor } from './WorkspaceEditor';
const labels: Record<AgentState, string> = { ready: '준비', analyzing: '분석', approval: '승인 대기', running: '실행', completed: '완료', failed: '실패', interrupted: '중단', 'setup-required': '설정 필요' };
export function AgentPanel({ id, paths, dirty }: { id: string; paths: string[]; dirty: boolean }) {
  const [mode, setMode] = useState<AgentMode>('ask'); const [view, setView] = useState<AgentView>();
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const epoch = useRef(0);
  const [prompt,setPrompt]=useState('');
  const call = async (action: 'status' | 'start' | 'stop' | 'analyze', selectedMode = mode) => {
    const generation = ++epoch.current; setBusy(action === 'analyze');
    try {
      const result = await window.desktop.agent.execute(action === 'analyze' ? { action, id, mode: selectedMode, paths } : { action, id, mode: selectedMode });
      if (generation === epoch.current) { setView(result); setMessage(''); }
    } catch { if (generation === epoch.current) setMessage('요청 실패: 로그인·프로젝트·파일 범위를 확인하세요.'); }
    finally { if (generation === epoch.current) setBusy(false); }
  };
  useEffect(() => { void call('status'); return () => { epoch.current++; }; }, [id]);
  return <section className="agent-panel" aria-label="AI 코딩 에이전트">
    <div className="agent-toolbar"><strong>AI 코딩 에이전트</strong><label>모드 <select aria-label="에이전트 모드" value={mode} onChange={event => { const next = event.target.value as AgentMode; setMode(next); void call('status', next); }}><option value="ask">Ask</option><option value="edit">Edit</option><option value="agent">Agent</option></select></label><span role="status">{busy ? '분석' : view ? labels[view.state] : '설정 필요'}</span><button onClick={() => void call('stop')}>에이전트 중단</button></div>
    <p>범위: 열린 파일 {paths.length}개 · {mode === 'ask' ? '읽기·설명만 허용' : mode === 'edit' ? '승인한 수정만 허용 · 명령 차단' : '분석 → 변경 승인 → 적용 · 명령 격리 미검증으로 실행 차단'}</p>
    <p>인증: {view?.authentication==='server'?'서버 API':'API 요청 전'} · 코딩 모델: {view?.model||'서버 설정 사용'}</p>
    <p>AI 요청 버튼을 누르면 열린 파일의 저장본이 서버를 통해 API 제공업체로 전송됩니다. 숨김·비밀 파일·키·빌드 폴더 제외. 최대 20개 / 파일당 256 KiB / 합계 1 MiB. 수정은 Diff 확인·승인 후 적용합니다.</p>
    <label>코딩 요청<textarea aria-label="코딩 요청" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={4000} rows={3} /></label>
    <button disabled={busy||dirty||!paths.length||!prompt.trim()} onClick={async()=>{
      const generation=++epoch.current;setBusy(true);setMessage('');
      try{const result=await window.desktop.agent.execute({action:'generate',id,mode,paths,prompt});if(generation===epoch.current)setView(result);}
      catch{if(generation===epoch.current)setMessage('AI 요청 실패. 서버 연결·모델 권한·저장 상태를 확인하세요.');}
      finally{if(generation===epoch.current)setBusy(false);}
    }}>열린 파일 전송·AI 요청</button>
    <button disabled={busy || !paths.length || dirty} onClick={() => void call('analyze')}>열린 파일 로컬 검사</button><button onClick={() => void call('start')}>AI 연결 상태 확인</button>
    {dirty && <p>저장하지 않은 Monaco 내용을 보존하기 위해 검사·적용을 차단합니다.</p>}
    <p role="status">{message || view?.message}</p>
    {!!view?.files.length && <ul>{view.files.map(file => <li key={file.path}>{file.path} · {file.bytes} bytes</li>)}</ul>}
    {view?.approval && <div className="agent-approval"><strong>파일 수정 승인 (요청 1회)</strong><p>요청 {view.approval.id} · 만료 {new Date(view.approval.expires).toLocaleTimeString()}</p>{view.approval.changes.map(change => <div key={change.path}><p>{change.path} · 수정 · 기준 {change.version}</p><div className="agent-diff"><WorkspaceEditor path={change.path} original={change.before} text={change.after} readOnly onChange={() => {}} onSave={() => {}} /></div></div>)}{[true, false].map(accept => <button key={String(accept)} disabled={dirty || busy} onClick={async () => {
      const p = view.approval!; const generation = ++epoch.current; setBusy(true);
      try { const next = await window.desktop.agent.execute({ action: 'decide', id, mode, approval: p.id, digest: p.digest, accept }); if (generation === epoch.current) setView(next); }
      catch { if (generation === epoch.current) setMessage('승인 만료·충돌·실패. 새 제안이 필요합니다.'); }
      finally { if (generation === epoch.current) setBusy(false); }
    }}>{accept ? '이번 수정 승인' : '거절'}</button>)}</div>}
    <p>실행 출력: AI 명령 실행 비활성화. 사용자 PowerShell PTY와 별개입니다.</p>
    {!!view?.applied.length && <p>적용: {view.applied.join(', ')}</p>}{!!view?.unapplied.length && <p>미적용: {view.unapplied.join(', ')}</p>}
  </section>;
}
