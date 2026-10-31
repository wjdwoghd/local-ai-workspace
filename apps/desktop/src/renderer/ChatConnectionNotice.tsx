import type { ChatStatus } from '../../../../packages/shared-types/chat';

export function ChatConnectionNotice({ status, checking, onRefresh, id }: { status?: ChatStatus; checking: boolean; onRefresh(): void; id: string }) {
  if (status?.configured && !checking) return null;
  return <div className="chat-connection-notice" id={id} role="status">
    <div><strong>{checking || !status ? 'AI 연결 확인 중…' : 'AI 전송을 사용할 수 없습니다'}</strong><p>{checking || !status ? '서버와 모델의 사용 가능 상태를 확인합니다.' : status.message}</p></div>
    <button type="button" disabled={checking} onClick={onRefresh}>{checking ? '확인 중…' : '연결 다시 확인'}</button>
  </div>;
}

export function ConnectionFeedback({ status, checking, checkedAt }: { status?: ChatStatus; checking: boolean; checkedAt?: number }) {
  if (!checking && checkedAt === undefined) return null;
  const state = checking ? 'checking' : status?.configured ? 'success' : 'failure';
  return <div className="connection-feedback" data-state={state} role="status" aria-live="polite" aria-busy={checking}>
    <strong>{checking ? '연결 확인 중…' : status?.configured ? '✓ 연결 정상' : '연결 확인 실패'}</strong>
    <span>{checking ? '서버와 기본 모델의 사용 가능 상태를 확인하고 있습니다.' : status?.message || '서버 연결 상태를 확인하지 못했습니다. 다시 시도해 주세요.'}</span>
    {!checking && checkedAt !== undefined && <small>{new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(checkedAt)} 확인</small>}
  </div>;
}
