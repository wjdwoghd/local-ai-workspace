import { useEffect, useState } from 'react';
import type { GitApproval, GitIntent, GitView } from '../../../../packages/shared-types/git';
export function GitPanel({ id, dirty }: { id: string; dirty: boolean }) {
  const [view, setView] = useState<GitView>(); const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState(''); const [approval, setApproval] = useState<GitApproval>();
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [url, setURL] = useState('');
  const [commit, setCommit] = useState(''); const [base, setBase] = useState('main'); const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const fail = (e: unknown) => setMessage((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
  async function refresh() { const result = await window.desktop.git({ action: 'status', id }); setView(result as GitView); setSelected([]); }
  useEffect(() => { let active = true; void window.desktop.git({ action: 'status', id }).then(result => { if (active) setView(result as GitView); }).catch(e => { if (active) fail(e); }); return () => { active = false; }; }, [id]);
  async function work(task: () => Promise<void>) { setBusy(true); setMessage(''); setURL(''); try { await task(); } catch (e) { fail(e); } finally { setBusy(false); } }
  async function prepare(operation: GitIntent['operation']) {
    setApproval(undefined);
    const result = await window.desktop.git({ action: 'prepare', id, intent: { operation, files: ['stage', 'unstage'].includes(operation) ? selected : [], message: commit, base, title, body } });
    setApproval(result as GitApproval);
  }
  return <details className="settings-card git-panel"><summary>Git / GitHub · {view?.branch || '저장소 연결 확인'}</summary>
    <p>GitHub CLI 브라우저 로그인: <code>gh auth login --web --hostname github.com --git-protocol https</code>. 이어서 <code>gh auth setup-git --hostname github.com</code>으로 Git 인증을 연결하세요. OS 자격 증명 저장소를 사용하세요. 평문 토큰 저장 상태는 연결을 거부합니다. 각 팀원은 별도 Windows 계정을 사용하세요.</p>
    <button disabled={busy} onClick={() => void work(async () => { setApproval(undefined); await refresh(); })}>Git 새로고침</button>
    {view && <><p>저장소: {view.root}<br />현재 브랜치: {view.branch || '분리된 HEAD'} · {view.head || '첫 커밋 전'}<br />브랜치 목록: {view.branches.join(', ') || '없음'}<br />origin: {view.remote || '지원하는 HTTPS GitHub 원격 없음'}<br />GitHub: {view.github ? `${view.github} 연결됨 (현재 Windows 계정)` : '미연결 · gh 설치/로그인/저장소/네트워크 확인'}</p>
      {view.conflicts && <p role="alert">미해결 충돌이 있습니다. 파일을 편집하고 해결한 파일만 스테이징하세요. 자동 복원하지 않습니다.</p>}
      <fieldset disabled={busy || !!approval}><legend>명시적으로 선택한 파일</legend>{view.changes.map(c => <div key={c.path}><label><input type="checkbox" disabled={c.blocked && !c.unstageAllowed} checked={selected.includes(c.path)} onChange={e => setSelected(old => e.target.checked ? [...old, c.path] : old.filter(p => p !== c.path))} />{c.index}{c.worktree} {c.path} {c.blocked ? c.unstageAllowed ? '(스테이징 해제만 허용)' : '(보호/지원 제한)' : ''}</label> <button disabled={c.blocked} onClick={() => void work(async () => { const result = await window.desktop.git({ action: 'diff', id, path: c.path }); if ('diff' in result) setDiff(result.diff); })}>diff</button></div>)}
        {!view.changes.length && <p>변경 없음</p>}<button disabled={!selected.length || dirty || view.changes.some(c => selected.includes(c.path) && c.blocked)} onClick={() => void work(() => prepare('stage'))}>선택 파일 스테이징 검토</button>{' '}<button disabled={!selected.length || dirty || view.changes.some(c => selected.includes(c.path) && !c.unstageAllowed)} onClick={() => void work(() => prepare('unstage'))}>선택 파일 해제 검토</button>
        <label>커밋 메시지 <input value={commit} maxLength={500} onChange={e => setCommit(e.target.value)} /></label><button disabled={!commit.trim() || dirty} onClick={() => void work(() => prepare('commit'))}>스테이징 전체 커밋 검토</button>
        <p>이 저장소의 hook·필터는 로컬 OS 권한으로 실행됩니다. 신뢰하는 프로젝트에서만 진행하세요.</p>
        <p>원격 작업 검토 시 비교를 위해 fetch합니다. 작업 파일·스테이징·현재 브랜치는 바꾸지 않습니다.</p><button disabled={!view.github || !view.remote || dirty} onClick={() => void work(() => prepare('push'))}>현재 브랜치 push 검토</button>{' '}<button disabled={!view.github || !view.remote || dirty} onClick={() => void work(() => prepare('pull'))}>현재 브랜치 pull 검토</button>
        <label>PR 대상 브랜치 <input value={base} onChange={e => setBase(e.target.value)} /></label><label>PR 제목 <input value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /></label><label>PR 설명 (목적·동작·검증·제약)<textarea value={body} maxLength={8000} onChange={e => setBody(e.target.value)} /></label><button disabled={!view.github || !title.trim() || dirty} onClick={() => void work(() => prepare('pr'))}>Draft PR 검토</button>
      </fieldset></>}
    {diff && <pre className="git-diff">{diff}</pre>}
    {approval && <section role="dialog" aria-label="Git 작업 승인"><h3>{approval.intent.operation} 실행 승인</h3><p>{approval.view.root} · {approval.view.branch} → {approval.view.remote || '로컬'}<br />GitHub 계정: {approval.view.github || '미연결'} · PR 대상: {approval.intent.base}<br />선택 파일: {approval.intent.files.join(', ') || '현재 스테이징/브랜치'}<br />메시지: {approval.intent.message} · 제목: {approval.intent.title}</p><pre>{approval.intent.body}</pre><pre className="git-diff">{approval.diff || '파일 diff 없음'}{'\n'}{approval.commits}</pre><p>저장소 상태가 바뀌면 승인이 취소됩니다. pull은 fast-forward만 허용합니다. 2분 안에 승인하세요.</p>{[false, true].map(accept => <button key={String(accept)} disabled={busy || dirty} onClick={() => void work(async () => { setApproval(undefined); const result = await window.desktop.git({ action: 'decide', id, token: approval.token, digest: approval.digest, accept }); if ('message' in result) { setMessage(result.message); setURL(result.url || ''); } await refresh(); })}>{accept ? '확인한 작업 실행' : '거절'}</button>)}</section>}
    <p role="status">{busy ? 'Git/GitHub 처리 중…' : message}</p>{url && <button onClick={() => void window.desktop.openSource(url)}>생성된 PR 열기 · {url}</button>}
  </details>;
}
