import { useEffect, useState } from "react";
import type { ConversationMeta, Settings, User } from "../../../../packages/shared-types/auth";
import App from "./App";
import { request } from "./api";

export default function Auth() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  function clear(message = "") {
    setUser(null); setEpoch(n => n + 1); setError(message);
    document.documentElement.dataset.theme = "light";
  }
  useEffect(() => {
    const expired = () => clear("세션이 만료되었거나 폐기되었습니다. 다시 로그인하세요.");
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!user) return;
    const check = () => { void request({ action: "me" }).catch(() => {}); };
    const timer = setInterval(check, 15000);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [user]);
  async function logout() {
    clear(); setBusy(true);
    try { await request({ action: "logout" }); }
    catch { setError("이 기기의 세션을 제거했습니다. 서버 로그아웃은 확인되지 않았습니다. 관리자에게 세션 폐기를 요청하세요."); }
    finally { setBusy(false); }
  }
  if (user) return <Workspace key={`${user.id}:${epoch}`} user={user} logout={() => void logout()} />;
  return <main className="login-page">
    <form className="settings-card login-card" onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const username = String(fields.get("username"));
      const password = String(fields.get("password"));
      form.reset(); setBusy(true); setError("");
      try { setUser(await request<User>({ action: "login", username, password })); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <div className="eyebrow">LOCAL AI WORKSPACE</div><h1>로그인</h1>
      <p>관리자에게 발급받은 팀원 계정으로 로그인하세요.</p>
      <label>계정 이름<input name="username" autoComplete="username" required maxLength={64} /></label>
      <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <button disabled={busy} type="submit">{busy ? "처리 중…" : "로그인"}</button>
      {error && <p role="alert" className="error">{error}</p>}
      <p>Astra · 로그인 후 서버의 AI 연결 상태를 확인할 수 있습니다.</p>
    </form>
  </main>;
}
function Workspace({ user, logout }: { user: User; logout: () => void }) {
  const [admin, setAdmin] = useState(false);
  const [data, setData] = useState<{ settings: Settings; conversations: ConversationMeta[] }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await request<Settings>({ action: "settings" });
      if (cancelled) return;
      let conversations = await request<ConversationMeta[]>({ action: "conversations" });
      if (cancelled) return;
      if (!conversations.length) conversations = [await request<ConversationMeta>({ action: "createConversation", title: "새 대화" })];
      if (!cancelled) setData({ settings, conversations });
    })().catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);
  return <div className="signed-workspace">
    <div className="session-bar"><span>{user.username} · {user.role === "admin" ? "관리자" : "일반 사용자"}</span>
      {user.role === "admin" && <button onClick={() => setAdmin(a => !a)}>{admin ? "내 워크스페이스" : "계정 관리"}</button>}
      <button onClick={logout}>로그아웃</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {admin && <Accounts />}
    <div hidden={admin}>{data ? <App user={user} initial={data} /> : <p role="status">개인 설정과 대화 목록을 불러오는 중…</p>}</div>
  </div>;
}
function Accounts() {
  const [users, setUsers] = useState<User[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setUsers(await request<User[]>({ action: "users" }));
  useEffect(() => { void refresh().catch(e => setMessage(e.message)); }, []);
  async function act(work: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await work(); await refresh(); setMessage("계정 작업을 완료했습니다."); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="accounts settings-page"><h1>팀원 계정 관리</h1>
    <p>신규·초기화 비밀번호는 12~128자입니다. 별도 보안 경로로 팀원에게 전달하세요. 초기화·비활성화 시 모든 기존 세션을 폐기합니다.</p>
    <form className="account-form" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); e.currentTarget.reset();
      void act(() => request({ action: "createUser", username: String(f.get("username")), password: String(f.get("password")), role: f.get("role") as User["role"] }));
    }}>
      <label>새 계정 이름<input name="username" required minLength={3} maxLength={64} autoComplete="off" /></label>
      <label>초기 비밀번호<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
      <label>역할<select name="role"><option value="user">일반 사용자</option><option value="admin">관리자</option></select></label>
      <button disabled={busy}>계정 생성</button>
    </form>
    <p role="status">{message}</p>
    {users.map(u => <div className="settings-card" key={u.id}>
      <strong>{u.username}</strong> · {u.role} · {u.active ? "활성" : "비활성"}
      <>
        <button disabled={busy || !u.active} onClick={() => void act(() => request({ action: "disableUser", id: u.id }))}>비활성화: {u.username}</button>
        <form className="account-form" onSubmit={e => {
          e.preventDefault(); const f = new FormData(e.currentTarget); e.currentTarget.reset();
          void act(() => request({ action: "resetPassword", id: u.id, password: String(f.get("password")) }));
        }}>
          <label>{u.username} 새 비밀번호<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
          <button disabled={busy}>비밀번호 초기화: {u.username}</button>
        </form>
      </>
    </div>)}
  </section>;
}
