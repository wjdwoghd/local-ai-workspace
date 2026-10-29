import { useEffect, useState } from 'react';
import type { Activity, UsageSummary } from '../../../../packages/shared-types/collaboration';
import type { User } from '../../../../packages/shared-types/auth';
import type { Team } from '../../../../packages/shared-types/search';
import { request } from './api';
export function Collaboration({ user }: { user: User }) {
  const [activity, setActivity] = useState<Activity[]>([]); const [usage, setUsage] = useState<UsageSummary>(); const [teams, setTeams] = useState<Team[]>([]); const [team, setTeam] = useState(''); const [aggregate, setAggregate] = useState<UsageSummary>(); const [error, setError] = useState('');
  async function load() { setError(''); try { const [a, u, t] = await Promise.all([request<Activity[]>({ action: 'activity' }), request<UsageSummary>({ action: 'myUsage' }), request<Team[]>({ action: 'teams' })]); setActivity(a); setUsage(u); setTeams(t); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void load(); }, []);
  const summary = (u: UsageSummary) => <p>{u.scope}<br />수집 {u.records}건 · 입력 {u.input ?? '확인 불가'} · 출력 {u.output ?? '확인 불가'} · 총 토큰 {u.total ?? '확인 불가'}<br />비용: 확인 불가. 미완료·중단·과거 요청의 미수집 사용량과 외부 앱 사용량은 포함되지 않습니다.</p>;
  return <section className="settings-page"><h1>팀 협업 · 작업 기록 · API 사용량</h1><p>공유 자료는 웹·파일 검색 화면에서 관리합니다. Git 작업은 로컬 개발 환경에서 실행합니다.</p><button onClick={() => void load()}>기록 새로고침</button>{error && <p role="alert">{error}</p>}<section className="settings-card"><h2>내 API 사용량</h2>{usage && summary(usage)}</section>
    {user.role === 'admin' && <section className="settings-card"><h2>허용된 팀 집계</h2><label>소속 팀 <select value={team} onChange={e => { setTeam(e.target.value); setAggregate(undefined); }}><option value="">선택</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button disabled={!team} onClick={() => { setError(''); void request<UsageSummary>({ action: 'teamUsage', id: team }).then(setAggregate).catch(e => { setAggregate(undefined); setError(e.message); }); }}>집계 조회</button>{aggregate && summary(aggregate)}</section>}
    <section className="settings-card"><h2>내 작업 기록 (최근 100건)</h2><p>Git 기록은 데스크톱이 보고한 실행 상태이며 저장소 내용·경로·메시지·인증정보는 저장하지 않습니다. started만 남으면 실제 저장소를 확인하세요.</p>{!activity.length && <p>수집된 작업 없음</p>}{activity.map(a => <p key={a.id}>{a.time} · {a.action} · {a.outcome}</p>)}</section></section>;
}
