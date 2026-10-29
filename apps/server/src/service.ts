import { randomUUID } from "node:crypto";
import type oracledb from "oracledb";
import type { Operation, User, ConversationMeta, Settings } from "../../../packages/shared-types/auth";
import type { Config } from "./config";
import { type DB, rows } from "./database/oracle";
import { ApiError, audit, digest, hashPassword, token, verifyPassword } from "./security";

interface UserRow { ID: string; USERNAME: string; ROLE: User["role"]; ACTIVE: number; PASSWORD_HASH: string }
const publicUser = (u: UserRow): User => ({ id: u.ID, username: u.USERNAME, role: u.ROLE, active: u.ACTIVE === 1 });
const missing = () => new ApiError(404, "리소스를 찾을 수 없습니다.");
export function service(db: DB, config: Config) {
  // Unknown accounts incur the same password derivation cost as existing accounts.
  const dummy = hashPassword(token());
  async function limit(ip: string, name: string) {
    const blocked = await db.transaction(async c => {
      let blocked = false;
      const keys = [digest(config.sessionSecret, `ip:${ip}`), digest(config.sessionSecret, `account:${name}`)];
      for (const key of keys) {
        await c.execute(`BEGIN INSERT INTO s2_login_limits (key_hash, attempts, reset_at)
          VALUES (:key, 0, SYS_EXTRACT_UTC(SYSTIMESTAMP) + INTERVAL '15' MINUTE);
          EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL; END;`, { key });
        await rows(c, "SELECT key_hash FROM s2_login_limits WHERE key_hash = :key FOR UPDATE", { key });
        await c.execute(`UPDATE s2_login_limits SET attempts = CASE WHEN reset_at <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN 1 ELSE attempts + 1 END,
          reset_at = CASE WHEN reset_at <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN SYS_EXTRACT_UTC(SYSTIMESTAMP) + INTERVAL '15' MINUTE ELSE reset_at END WHERE key_hash = :key`, { key });
        const [r] = await rows<{ ATTEMPTS: number }>(c, "SELECT attempts FROM s2_login_limits WHERE key_hash = :key", { key });
        if (r.ATTEMPTS > (key === digest(config.sessionSecret, `account:${name}`) ? 10 : 100)) { blocked = true; break; }
      }
      return blocked;
    });
    if (blocked) { audit("login_limited"); throw new ApiError(429, "로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요."); }
  }
  async function authenticate(c: oracledb.Connection, credential?: string): Promise<User> {
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new ApiError(401, "로그인이 필요하거나 세션이 만료되었습니다.");
    const hash = digest(config.sessionSecret, credential);
    const [s] = await rows<{ USER_ID: string }>(c, "SELECT user_id FROM s2_sessions WHERE token_hash = :hash AND expires_at > SYS_EXTRACT_UTC(SYSTIMESTAMP)", { hash });
    if (!s) throw new ApiError(401, "로그인이 필요하거나 세션이 만료되었습니다.");
    // All protected operations serialize on their actor, including logout and revocation.
    const [u] = await rows<UserRow>(c, "SELECT * FROM s2_users WHERE id = :id FOR UPDATE", { id: s.USER_ID });
    const [valid] = await rows(c, "SELECT token_hash FROM s2_sessions WHERE token_hash = :hash AND expires_at > SYS_EXTRACT_UTC(SYSTIMESTAMP)", { hash });
    if (!u || u.ACTIVE !== 1 || !valid) throw new ApiError(401, "로그인이 필요하거나 세션이 만료되었습니다.");
    return publicUser(u);
  }
  return {
    async bootstrap(name: string, password: string) {
      const hash = await hashPassword(password);
      return db.transaction(async c => {
        await rows(c, "SELECT id FROM s2_control WHERE id = 1 FOR UPDATE");
        const [r] = await rows<{ TOTAL: number }>(c, "SELECT COUNT(*) AS total FROM s2_users");
        if (r.TOTAL) throw new ApiError(409, "초기 관리자 생성은 빈 사용자 테이블에서 한 번만 가능합니다.");
        await c.execute("INSERT INTO s2_users (id, username, password_hash, role, active) VALUES (:id, :name, :hash, 'admin', 1)", { id: randomUUID(), name, hash });
      });
    },
    async execute(op: Operation, credential: string | undefined, ip: string): Promise<unknown> {
      if (op.action === "login") {
        await limit(ip, op.username);
        const result = await db.transaction(async c => {
          const [u] = await rows<UserRow>(c, "SELECT * FROM s2_users WHERE username = :name FOR UPDATE", { name: op.username });
          const correct = await verifyPassword(op.password, u?.PASSWORD_HASH ?? await dummy);
          if (!u || !correct || u.ACTIVE !== 1) return null;
          const credential = token();
          await c.execute("DELETE FROM s2_sessions WHERE user_id = :id AND expires_at <= SYS_EXTRACT_UTC(SYSTIMESTAMP)", { id: u.ID });
          await c.execute(`INSERT INTO s2_sessions (token_hash, user_id, expires_at) VALUES (:hash, :id,
            SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(:minutes, 'MINUTE'))`,
          { hash: digest(config.sessionSecret, credential), id: u.ID, minutes: config.sessionMinutes });
          return { user: publicUser(u), credential };
        });
        if (!result) { audit("login_failed"); throw new ApiError(401, "계정 또는 비밀번호를 확인하세요."); }
        audit("login_ok"); return result;
      }
      const result = await db.transaction(async c => {
        // Acquire the management lock before actor/target locks to avoid admin-to-admin deadlocks.
        if (["createUser", "disableUser", "resetPassword"].includes(op.action)) await rows(c, "SELECT id FROM s2_control WHERE id = 1 FOR UPDATE");
        const user = await authenticate(c, credential);
        const owner = { owner: user.id };
        if (["users", "createUser", "disableUser", "resetPassword"].includes(op.action) && user.role !== "admin") throw new ApiError(403, "관리자 권한이 필요합니다.");
        switch (op.action) {
          case "me": return user;
          case "logout":
            await c.execute("DELETE FROM s2_sessions WHERE token_hash = :hash", { hash: digest(config.sessionSecret, credential!) }); return null;
          case "users": return (await rows<UserRow>(c, "SELECT id, username, role, active FROM s2_users ORDER BY username")).map(publicUser);
          case "createUser": {
            const id = randomUUID();
            try {
              await c.execute("INSERT INTO s2_users (id, username, password_hash, role, active) VALUES (:id, :name, :hash, :role, 1)",
                { id, name: op.username, hash: await hashPassword(op.password), role: op.role });
            } catch (e) { if ((e as { errorNum?: number }).errorNum === 1) throw new ApiError(409, "이미 존재하는 계정입니다."); throw e; }
            return { id, username: op.username, role: op.role, active: true } satisfies User;
          }
          case "disableUser":
          case "resetPassword": {
            if (op.id === user.id) throw new ApiError(400, "자기 계정은 이 관리 작업의 대상이 될 수 없습니다.");
            const [target] = await rows<UserRow>(c, "SELECT * FROM s2_users WHERE id = :id", { id: op.id });
            if (!target) throw missing();
            await rows(c, "SELECT id FROM s2_users WHERE id = :id FOR UPDATE", { id: op.id });
            if (op.action === "disableUser") await c.execute("UPDATE s2_users SET active = 0 WHERE id = :id", { id: op.id });
            else await c.execute("UPDATE s2_users SET password_hash = :hash WHERE id = :id", { id: op.id, hash: await hashPassword(op.password) });
            await c.execute("DELETE FROM s2_sessions WHERE user_id = :id", { id: op.id });
            return null;
          }
          case "settings": {
            const [s] = await rows<{ THEME: Settings["theme"] }>(c, "SELECT theme FROM s2_settings WHERE user_id = :owner", owner);
            return { theme: s?.THEME ?? "system" } satisfies Settings;
          }
          case "saveSettings":
            await c.execute(`MERGE INTO s2_settings s USING (SELECT :owner user_id, :theme theme FROM dual) v ON (s.user_id = v.user_id)
              WHEN MATCHED THEN UPDATE SET s.theme = v.theme WHEN NOT MATCHED THEN INSERT (user_id, theme) VALUES (v.user_id, v.theme)`, { ...owner, theme: op.theme }); return null;
          case "resetSettings": await c.execute("DELETE FROM s2_settings WHERE user_id = :owner", owner); return null;
          case "conversations": return (await rows<{ ID: string; TITLE: string }>(c, "SELECT id, title FROM s2_conversations WHERE user_id = :owner ORDER BY id", owner)).map(r => ({ id: r.ID, title: r.TITLE }));
          case "createConversation": {
            const id = randomUUID();
            await c.execute("INSERT INTO s2_conversations (id, user_id, title) VALUES (:id, :owner, :title)", { ...owner, id, title: op.title });
            return { id, title: op.title } satisfies ConversationMeta;
          }
          case "getConversation": {
            const [r] = await rows<{ ID: string; TITLE: string }>(c, "SELECT id, title FROM s2_conversations WHERE id = :id AND user_id = :owner", { ...owner, id: op.id });
            if (!r) throw missing(); return { id: r.ID, title: r.TITLE };
          }
          case "updateConversation":
          case "deleteConversation": {
            const r = op.action === "updateConversation"
              ? await c.execute("UPDATE s2_conversations SET title = :title WHERE id = :id AND user_id = :owner", { ...owner, id: op.id, title: op.title })
              : await c.execute("DELETE FROM s2_conversations WHERE id = :id AND user_id = :owner", { ...owner, id: op.id });
            if (!r.rowsAffected) throw missing(); return null;
          }
        }
      });
      const events = { logout: "logout", createUser: "user_created", disableUser: "user_disabled", resetPassword: "password_reset" } as const;
      if (op.action in events) audit(events[op.action as keyof typeof events]);
      return result;
    },
  };
}
