import { useEffect, useState } from 'react';
import type { LocalProfileView } from '../../../../packages/shared-types/local-profile';
import type { Activity } from '../../../../packages/shared-types/collaboration';
import type { Theme } from '../../../../packages/shared-types/auth';
import App from './App';
import { confirmWorkspaceLeave } from './workspace-guard';
import { request } from './api';

export function LocalProfiles() {
  const [view, setView] = useState<LocalProfileView>();
  const [selected, setSelected] = useState(''); const [name, setName] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  useEffect(() => { let live = true; void window.desktop.profiles({ action: 'list' }).then(v => { if (live) { setView(v); setSelected(v.profiles[0]?.id || ''); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const theme = view?.theme || 'system'; document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [view?.theme]);
  async function work(task: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await task(); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
    finally { setBusy(false); }
  }
  if (!view?.active) return <main className="login-page"><div className="settings-card login-card">
    <div className="eyebrow">LOCAL WORKSPACES</div><h1>팀원 작업 공간 선택</h1>
    <p>이 기기에 개인 작업 공간을 저장하고 연결된 API 서버를 사용합니다.</p>
    {view && <><form onSubmit={e => { e.preventDefault(); void work(async () => { setView(await window.desktop.profiles({ action: 'select', id: selected })); setActivity([]); }); }}>
      <label>팀원 이름<select aria-label="팀원 이름" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}><option value="">선택하세요</option>{view.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button disabled={busy || !selected}>작업 공간 열기</button>
    </form><form onSubmit={e => { e.preventDefault(); void work(async () => { const next = await window.desktop.profiles({ action: 'create', name }); setView(next); setSelected(next.profiles.find(p => p.name === name.normalize('NFC').toLowerCase())?.id || ''); setName(''); }); }}>
      <label>새 팀원 이름<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={64} required disabled={busy} autoComplete="off" /></label>
      <button disabled={busy || !name.trim()}>개인 작업 공간 만들기</button>
    </form></>}
    <p>프로필 선택 방식이며 비밀번호 로그인은 사용하지 않습니다.</p>
    {error && <p role="alert">{error}</p>}
  </div></main>;
  return <div className="signed-workspace local-mode">
    {error && <p role="alert">{error}</p>}
    <App key={view.active.id} local user={{id:view.active.id,username:view.active.name,role:'user',active:true}} initial={{settings:{theme:view.theme},conversations:[]}} onThemeChange={theme=>setView({...view,theme})} controls={<>
      <span className="mode-user">{view.active.name}</span>
      <select aria-label="개인 화면 테마" value={view.theme} disabled={busy} onChange={e => void work(async () => { const theme = e.target.value as Theme; await request({ action: 'saveSettings', theme }); setView({ ...view, theme }); })}><option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option></select>
      <button disabled={busy} onClick={() => void work(async () => { if (!await confirmWorkspaceLeave()) return; setView(await window.desktop.profiles({ action: 'leave' })); setActivity([]); })}>프로필 전환</button>
    </>} extraSettings={<details className="local-records"><summary>내 작업 기록</summary><button onClick={() => void work(async () => setActivity(await request<Activity[]>({ action: 'activity' })))}>기록 새로고침</button>{!activity.length && <p>표시할 기록이 없습니다.</p>}{activity.map(a => <p key={a.id}>{a.time} · {a.action} · {a.outcome}</p>)}</details>} />
  </div>;
}
