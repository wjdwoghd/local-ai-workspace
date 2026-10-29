import { useEffect, useState } from 'react';
import type { User } from '../../../../packages/shared-types/auth';
import { safeWebURL, type Citation, type DocumentMeta, type SearchHit, type Team } from '../../../../packages/shared-types/search';
import { request } from './api';

export function Sources({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const [preview, setPreview] = useState<{ name: string; parts: { chunk: number; location: string; text: string }[] }>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number>();
  async function open(c: Citation) {
    setError('');
    try {
      if (c.kind === 'web' && safeWebURL(c.url)) await window.desktop.openSource(c.url);
      else if (c.kind === 'document' && c.documentId) {
        const doc = await request<NonNullable<typeof preview>>({ action: 'readDocument', id: c.documentId });
        setPreview(doc); setSelected(c.chunk);
      }
    } catch (e) { setError((e as Error).message); }
  }
  const ranges = citations.filter(c => c.kind === 'web' && safeWebURL(c.url) && Number.isInteger(c.start) && Number.isInteger(c.end) && c.start! >= 0 && c.end! > c.start! && c.end! <= text.length).map(c => ({ start: c.start!, end: c.end!, citation: c }));
  for (const match of text.matchAll(/\[D\d+\]/g)) {
    const c = citations.find(c => c.kind === 'document' && c.title.startsWith(match[0] + ' '));
    if (c) ranges.push({ start: match.index!, end: match.index! + match[0].length, citation: c });
  }
  ranges.sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset) continue;
    nodes.push(text.slice(offset, range.start));
    nodes.push(<button className="inline-citation" key={`${range.start}-${range.end}`} title={range.citation.title} onClick={() => void open(range.citation)}>{text.slice(range.start, range.end)}</button>);
    offset = range.end;
  }
  nodes.push(text.slice(offset));
  return <>
    <p>{nodes}</p>
    {!!citations.length && <div className="sources" aria-label="검색 출처"><strong>검색 출처</strong>{citations.map((c, i) => <button key={i} onClick={() => void open(c)}>{c.title}{c.location ? ` · ${c.location}` : ' ↗'}</button>)}</div>}
    {error && <p role="alert">{error}</p>}
    {preview && <div className="document-preview" role="dialog" aria-modal="false" aria-label="문서 출처"><button autoFocus onClick={() => setPreview(undefined)}>출처 닫기</button><h2>{preview.name}</h2>{preview.parts.filter(p => selected === undefined || p.chunk === selected).map(p => <section key={p.chunk}><strong>{p.location}</strong><p>{p.text}</p></section>)}<button onClick={() => setSelected(undefined)}>전체 추출문 보기</button></div>}
  </>;
}

export function Documents({ user }: { user: User }) {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<User[]>([]);
  const [memberId, setMemberId] = useState('');
  async function refresh() {
    const [docs, teams] = await Promise.all([request<DocumentMeta[]>({ action: 'documents' }), request<Team[]>({ action: 'teams' })]);
    setDocs(docs); setTeams(teams);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([request<DocumentMeta[]>({ action: 'documents' }), request<Team[]>({ action: 'teams' }), user.role === 'admin' ? request<User[]>({ action: 'users' }) : Promise.resolve([])]).then(([d, t, u]) => { if (active) { setDocs(d); setTeams(t); setMembers(u.filter(u => u.active)); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user.role]);
  async function work(task: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="settings-page document-page" aria-label="문서 검색 화면">
    <div className="eyebrow">SOURCES</div><h1>웹·파일 검색</h1>
    <p>선택한 파일을 서버에 등록해 검색합니다. 개인 문서와 현재 소속된 팀의 공용 문서만 표시됩니다. 웹 검색은 채팅 입력창에서 선택하세요.</p>
    {error && <p className="error" role="alert">{error}</p>}<p role="status">{busy ? '처리 중…' : notice}</p>
    <section className="settings-card"><h2>문서 등록</h2><p>PDF, DOCX, XLSX, PPTX, TXT, MD · 파일당 최대 10MB. 선택한 문서의 추출문이 서버에 저장됩니다.</p>
      <fieldset disabled={busy}><legend className="sr-only">문서 등록 범위</legend><label>등록 범위 <select value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">개인 문서</option>{teams.map(t => <option key={t.id} value={t.id}>팀 · {t.name}</option>)}</select></label>{' '}
        <button onClick={() => void work(async () => { const result = await window.desktop.importDocument(teamId || null); if (!result.ok) { if (result.status === 401) window.dispatchEvent(new Event('session-expired')); throw new Error(result.message); } if (result.data) { await refresh(); setHits([]); setSearched(false); setNotice('문서를 등록했습니다.'); } })}>로컬 파일 선택·등록</button>
      </fieldset>
    </section>
    <form className="settings-card" onSubmit={e => { e.preventDefault(); void work(async () => { setHits(await request<SearchHit[]>({ action: 'searchDocuments', query })); setSearched(true); }); }}><h2>내 문서·팀 문서 검색</h2><label>검색어 <input value={query} maxLength={200} onChange={e => setQuery(e.target.value)} /></label>{' '}<button disabled={busy || !query.trim()}>검색</button><p>단어 일치 기준으로 관련 구간을 최대 6개 표시합니다.</p>
      {searched && !hits.length && <p>검색 결과가 없습니다.</p>}{hits.map(h => <article className="search-hit" key={`${h.documentId}-${h.chunk}`}><Sources text={h.text} citations={[{ kind: 'document', title: h.name, documentId: h.documentId, chunk: h.chunk, location: h.location }]} /></article>)}
    </form>
    <section className="settings-card"><h2>등록 문서 {docs.length}개</h2>{!docs.length && <p>등록된 문서가 없습니다.</p>}{docs.map(d => <div className="document-row" key={d.id}><div><strong>{d.name}</strong><small>{d.teamId ? `팀 · ${teams.find(t => t.id === d.teamId)?.name ?? ''}` : '개인'} · {d.chunks}개 구간</small></div>{d.owner === user.id && <button disabled={busy} onClick={() => void work(async () => { await request({ action: 'deleteDocument', id: d.id }); await refresh(); setHits([]); setSearched(false); setNotice('문서를 삭제했습니다.'); })}>삭제</button>}</div>)}</section>
    {user.role === 'admin' && <section className="settings-card"><h2>팀 권한 관리</h2><p>팀을 만들면 관리자가 첫 구성원으로 등록됩니다. 구성원에게 해당 팀 문서의 읽기·등록 권한을 부여합니다.</p><fieldset disabled={busy}><legend className="sr-only">팀 관리</legend><label>새 팀 이름 <input value={teamName} maxLength={100} onChange={e => setTeamName(e.target.value)} /></label>{' '}<button disabled={!teamName.trim()} onClick={() => void work(async () => { const team = await request<Team>({ action: 'createTeam', name: teamName }); await refresh(); setTeamId(team.id); setTeamName(''); })}>팀 만들기</button><p>선택한 등록 범위의 팀에 구성원을 추가·제외합니다.</p><label>구성원 <select value={memberId} onChange={e => setMemberId(e.target.value)}><option value="">계정 선택</option>{members.map(m => <option key={m.id} value={m.id}>{m.username}</option>)}</select></label>{' '}{(['addTeamMember', 'removeTeamMember'] as const).map(action => <button key={action} disabled={!teamId || !memberId} onClick={() => void work(async () => { await request({ action, id: teamId, userId: memberId }); await refresh(); setHits([]); setSearched(false); setNotice(action === 'addTeamMember' ? '팀 구성원을 추가했습니다.' : '팀 구성원을 제외했습니다.'); })}>{action === 'addTeamMember' ? '구성원 추가' : '구성원 제외'}</button>)}</fieldset></section>}
  </section>;
}
