import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Operation, User, ConversationMeta, Settings } from "../../../../packages/shared-types/auth";
import { config } from "../../src/config";
import { database, poolFor, rows } from "../../src/database/oracle";
import { migrate } from "../../src/database/migrate";
import { service } from "../../src/service";
import { app } from "../../src/app";
import { digest, token } from "../../src/security";
import { chatStore } from '../../src/chat-store';
import type { ChatMessage } from '../../../../packages/shared-types/chat';
import { documents } from '../../src/documents';
import type { DocumentMeta, SearchHit, Team } from '../../../../packages/shared-types/search';
import { collaboration } from '../../src/collaboration';
import type { Activity, UsageSummary } from '../../../../packages/shared-types/collaboration';

const enabled = ["TEST_ORACLE_USER", "TEST_ORACLE_PASSWORD", "TEST_ORACLE_CONNECT_STRING", "TEST_ORACLE_CONFIRM_SCHEMA"].some(key => Boolean(process.env[key]));
it.skipIf(!enabled)("real Oracle: ten users, ownership CRUD, RBAC, session revocation, expiry, throttling, transactions", async () => {
  const name = process.env.TEST_ORACLE_USER!;
  // Fail before opening ANY connection if the test destination is not explicitly isolated.
  if (!/^LAW_TEST_[A-Z0-9_]+$/.test(name) || name !== process.env.TEST_ORACLE_CONFIRM_SCHEMA || name.toUpperCase() === process.env.ORACLE_USER?.toUpperCase()) {
    throw new Error("전용 LAW_TEST_* 스키마 및 TEST_ORACLE_CONFIRM_SCHEMA를 확인하세요. 운영 스키마에서는 실행하지 않습니다.");
  }
  const c = config({ ORACLE_USER: name, ORACLE_PASSWORD: process.env.TEST_ORACLE_PASSWORD,
    ORACLE_CONNECT_STRING: process.env.TEST_ORACLE_CONNECT_STRING, SESSION_SECRET: token() });
  const pool = await poolFor(c);
  const db = database(pool);
  const auth = service(db, c);
  const store = chatStore(auth);
  const docs = documents(auth);
  const collaborationService = collaboration(auth);
  const server = app(auth, undefined, docs, collaborationService);
  const run = randomUUID().slice(0, 8);
  const adminName = `admin.${run}`;
  const password = token();
  const created: string[] = [];
  const createdTeams: string[] = [];
  const limitKeys: string[] = [];
  const ip = `test-${run}`;
  let adminId: string | undefined;
  let bootstrapped = false;
  const call = async <T = unknown>(op: Operation, credential?: string, expected = 200): Promise<T> => {
    const response = await server.inject({ method: "POST", url: "/api/action", remoteAddress: ip,
      payload: op, headers: credential ? { authorization: `Bearer ${credential}` } : {} });
    expect(response.statusCode, response.body).toBe(expected);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.json().data as T;
  };
  try {
    await db.transaction(async connection => {
      const [r] = await rows<{ NAME: string }>(connection, "SELECT SYS_CONTEXT('USERENV', 'SESSION_USER') AS name FROM dual");
      expect(r.NAME).toBe(name);
      try {
        const [u] = await rows<{ TOTAL: number }>(connection, "SELECT COUNT(*) AS total FROM s2_users");
        if (u.TOTAL !== 0) throw new Error("통합 테스트는 사용자 데이터가 없는 전용 스키마에서만 실행합니다.");
      } catch (e) { if ((e as { errorNum?: number }).errorNum !== 942) throw e; }
    });
    await migrate(pool); await migrate(pool);
    await auth.bootstrap(adminName, password);
    bootstrapped = true;
    limitKeys.push(digest(c.sessionSecret, `ip:${ip}`), digest(c.sessionSecret, `account:${adminName}`));
    const admin = await call<{ credential: string; user: User }>({ action: "login", username: adminName, password });
    adminId = admin.user.id;
    await expect(auth.bootstrap(`other.${run}`, token())).rejects.toMatchObject({ status: 409 });
    await call({ action: "users" }, undefined, 401);
    await call({ action: "login", username: adminName, password: token() }, undefined, 401);
    const accounts: { user: User; credential: string; meta: ConversationMeta }[] = [];
    for (let i = 0; i < 10; i++) {
      const username = `team.${run}.${i}`;
      const user = await call<User>({ action: "createUser", username, password, role: "user" }, admin.credential);
      created.push(user.id); limitKeys.push(digest(c.sessionSecret, `account:${username}`));
      const login = await call<{ credential: string; user: User }>({ action: "login", username, password });
      expect(login.user.id).toBe(user.id);
      const meta = await call<ConversationMeta>({ action: "createConversation", title: `private-${i}` }, login.credential);
      accounts.push({ user, credential: login.credential, meta });
      await call({ action: "saveSettings", theme: i % 2 ? "dark" : "light" }, login.credential);
    }
    // Real SQL ACLs, CLOB citations, team revocation and cascade deletion.
    const personalDocs: DocumentMeta[] = [];
    for (let i = 0; i < 10; i++) personalDocs.push(await docs.upload({ name: `private-${i}.txt`, base64: Buffer.from(`공통검색 개인기밀 ${i}`).toString('base64'), teamId: null }, accounts[i].credential));
    for (let i = 0; i < 10; i++) {
      const own = personalDocs[i], other = personalDocs[(i + 1) % 10];
      expect((await call<SearchHit[]>({ action: 'searchDocuments', query: '공통검색' }, accounts[i].credential)).map(h => h.documentId)).toEqual([own.id]);
      for (const credential of [accounts[i].credential, admin.credential]) {
        await call({ action: 'readDocument', id: other.id }, credential, 404);
        await call({ action: 'deleteDocument', id: other.id }, credential, 404);
      }
      expect(await call({ action: 'readDocument', id: own.id }, accounts[i].credential)).toMatchObject({ name: own.name, parts: [{ chunk: 1, location: '줄 1', text: `공통검색 개인기밀 ${i}` }] });
    }
    const team = await call<Team>({ action: 'createTeam', name: `test-${run}` }, admin.credential); createdTeams.push(team.id);
    await call({ action: 'createTeam', name: 'forged' }, accounts[0].credential, 403);
    for (const account of accounts.slice(0, 2)) await call({ action: 'addTeamMember', id: team.id, userId: account.user.id }, admin.credential);
    for (let i = 0; i < 10; i++) {
      const actor = accounts[i];
      await call({ action: 'recordGit', operation: 'commit', outcome: 'succeeded' }, actor.credential);
      expect((await call<Activity[]>({ action: 'activity' }, actor.credential)).filter(a => a.action === 'git.commit')).toHaveLength(1);
      expect(await call<UsageSummary>({ action: 'myUsage' }, actor.credential)).toMatchObject({ records: 0, total: null, cost: null });
      await collaborationService.recordUsage(actor.meta.id, actor.meta.id, 'fixture-model', { input: i + 1, output: 1, total: i + 2 }, actor.credential);
      await collaborationService.recordUsage(actor.meta.id, actor.meta.id, 'fixture-model', { input: i + 1, output: 1, total: i + 2 }, actor.credential);
      expect(await call<UsageSummary>({ action: 'myUsage' }, actor.credential)).toMatchObject({ records: 1, total: i + 2 });
      await expect(collaborationService.recordUsage(accounts[(i + 1) % 10].meta.id, randomUUID(), 'fixture', { input: 1, output: 1, total: 2 }, actor.credential)).rejects.toMatchObject({ status: 404 });
      await call({ action: 'teamUsage', id: team.id }, actor.credential, 403);
      await call({ action: 'shareDocument', id: personalDocs[(i + 1) % 10].id, teamId: team.id }, actor.credential, 404);
    }
    expect(await call<UsageSummary>({ action: 'teamUsage', id: team.id }, admin.credential)).toMatchObject({ records: 2, total: 5 });
    await call({ action: 'shareDocument', id: personalDocs[0].id, teamId: team.id }, admin.credential, 404);
    await call({ action: 'shareDocument', id: personalDocs[2].id, teamId: team.id }, accounts[2].credential, 403);
    await call({ action: 'shareDocument', id: personalDocs[0].id, teamId: team.id }, accounts[0].credential);
    await call({ action: 'readDocument', id: personalDocs[0].id }, accounts[1].credential);
    await call({ action: 'readDocument', id: personalDocs[0].id }, accounts[2].credential, 404);
    await call({ action: 'shareDocument', id: personalDocs[0].id, teamId: null }, accounts[1].credential, 404);
    await call({ action: 'shareDocument', id: personalDocs[0].id, teamId: null }, accounts[0].credential);
    await call({ action: 'readDocument', id: personalDocs[0].id }, accounts[1].credential, 404);
    const shared = await docs.upload({ name: '팀정책.txt', base64: Buffer.from('팀검색 휴가 20일').toString('base64'), teamId: team.id }, accounts[0].credential);
    expect(await call<SearchHit[]>({ action: 'searchDocuments', query: '팀검색' }, accounts[1].credential)).toHaveLength(1);
    expect(await call<SearchHit[]>({ action: 'searchDocuments', query: '팀검색' }, accounts[2].credential)).toEqual([]);
    await expect(docs.upload({ name: 'forged.txt', base64: 'YQ==', teamId: team.id }, accounts[2].credential)).rejects.toMatchObject({ status: 403 });
    await call({ action: 'removeTeamMember', id: team.id, userId: accounts[0].user.id }, accounts[1].credential, 403);
    await call({ action: 'removeTeamMember', id: team.id, userId: accounts[0].user.id }, admin.credential);
    await call({ action: 'readDocument', id: shared.id }, accounts[0].credential, 404);
    await call({ action: 'shareDocument', id: shared.id, teamId: null }, accounts[0].credential, 404);
    await call({ action: 'deleteDocument', id: shared.id }, accounts[0].credential, 404);
    expect(await docs.search('팀검색', accounts[0].credential)).toEqual([]);
    await expect(docs.verify([shared.id], accounts[0].credential)).rejects.toMatchObject({ status: 403 });
    await call({ action: 'deleteDocument', id: personalDocs[0].id }, accounts[0].credential);
    expect(await db.transaction(c => rows(c, 'SELECT ordinal FROM s4_chunks WHERE document_id = :id', { id: personalDocs[0].id }))).toEqual([]);
    for (let i = 0; i < 10; i++) {
      const a = accounts[i], other = accounts[(i + 1) % 10];
      expect(await call({ action: "me" }, a.credential)).toMatchObject({ id: a.user.id });
      expect(await call({ action: "conversations" }, a.credential)).toEqual([a.meta]);
      expect(await call<Settings>({ action: "settings" }, a.credential)).toEqual({ theme: i % 2 ? "dark" : "light" });
      for (const credential of [a.credential, admin.credential]) {
        await call({ action: 'messages', id: other.meta.id }, credential, 404);
        await expect(store.prepare({ id: other.meta.id, text: 'forged', model: 'gpt-6-astra' }, credential)).rejects.toMatchObject({ status: 404 });
        await call({ action: "getConversation", id: other.meta.id }, credential, 404);
        await call({ action: "updateConversation", id: other.meta.id, title: "stolen" }, credential, 404);
        await call({ action: "deleteConversation", id: other.meta.id }, credential, 404);
      }
      await call({ action: "users" }, a.credential, 403);
      await call({ action: "createUser", username: `forged.${run}`, password, role: "admin" }, a.credential, 403);
      await call({ action: "disableUser", id: other.user.id }, a.credential, 403);
      await call({ action: "resetPassword", id: other.user.id, password }, a.credential, 403);
      const input = { id: a.meta.id, text: `private turn ${i}`, model: 'gpt-6-astra' };
      expect(await call({ action: 'messages', id: a.meta.id }, a.credential)).toEqual([]);
      const prepared = await store.prepare(input, a.credential);
      expect(prepared.messages).toEqual([]);
      // A separate service instance must see the DB lease, including after process restart.
      await expect(chatStore(service(db, c)).prepare(input, a.credential)).rejects.toMatchObject({ status: 409 });
      await expect(store.finish(input, randomUUID(), 'forged finish', a.credential)).rejects.toMatchObject({ status: 409 });
      const citations = [{ kind: 'web' as const, title: '출처', url: 'https://example.com' }];
      await store.finish(input, prepared.run, `private answer ${i}`, a.credential, citations);
      const saved = await call<ChatMessage[]>({ action: 'messages', id: a.meta.id }, a.credential);
      expect(saved.map(m => m.text)).toEqual([input.text, `private answer ${i}`]);
      expect(saved[1].citations).toEqual(citations);
      const restored = await chatStore(service(db, c)).prepare(input, a.credential);
      expect(restored.messages).toEqual(saved);
      await store.release(input.id, restored.run, a.credential);
      await call({ action: "updateConversation", id: a.meta.id, title: "owned" }, a.credential);
      expect(await call({ action: "getConversation", id: a.meta.id }, a.credential)).toMatchObject({ title: "owned" });
      await call({ action: "deleteConversation", id: a.meta.id }, a.credential);
      expect(await db.transaction(connection => rows(connection, 'SELECT id FROM s3_messages WHERE conversation_id = :id', { id: a.meta.id }))).toEqual([]);
      await call({ action: "getConversation", id: a.meta.id }, a.credential, 404);
      await call({ action: "resetSettings" }, a.credential);
      expect(await call({ action: "settings" }, a.credential)).toEqual({ theme: "system" });
    }
    const forged = await server.inject({ method: "POST", url: "/api/action", payload: { action: "settings", userId: created[1] }, headers: { authorization: `Bearer ${accounts[0].credential}` } });
    expect(forged.statusCode).toBe(400);
    await call({ action: "logout" }, accounts[0].credential);
    await call({ action: "me" }, accounts[0].credential, 401);
    await db.transaction(async connection => { await connection.execute("UPDATE s2_sessions SET expires_at = SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL '1' MINUTE WHERE user_id = :id", { id: created[1] }); });
    await call({ action: "me" }, accounts[1].credential, 401);
    const second = await call<{ credential: string }>({ action: "login", username: accounts[2].user.username, password });
    await call({ action: "disableUser", id: created[2] }, admin.credential);
    for (const credential of [accounts[2].credential, second.credential]) await call({ action: "me" }, credential, 401);
    await call({ action: "login", username: accounts[2].user.username, password }, undefined, 401);
    const replacement = token();
    await call({ action: "resetPassword", id: created[3], password: replacement }, admin.credential);
    await call({ action: "me" }, accounts[3].credential, 401);
    await call({ action: "login", username: accounts[3].user.username, password }, undefined, 401);
    await call({ action: "login", username: accounts[3].user.username, password: replacement });
    const unknown = `unknown.${run}`;
    limitKeys.push(digest(c.sessionSecret, `account:${unknown}`));
    for (let i = 0; i < 10; i++) await call({ action: "login", username: unknown, password }, undefined, 401);
    await call({ action: "login", username: unknown, password }, undefined, 429);
    const rollbackId = randomUUID();
    await expect(db.transaction(async connection => {
      await connection.execute("INSERT INTO s2_conversations (id, user_id, title) VALUES (:id, :owner, 'rollback')", { id: rollbackId, owner: created[0] });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await db.transaction(connection => rows(connection, "SELECT id FROM s2_conversations WHERE id = :id", { id: rollbackId }))).toEqual([]);
  } finally {
    await server.close();
    try {
      if (bootstrapped) await db.transaction(async connection => {
        for (const id of createdTeams) await connection.execute('DELETE FROM s4_teams WHERE id = :id', { id });
        // Delete only users created by this run, with FK cascade; never truncate or drop a schema.
        const ids = [...created, ...(adminId ? [adminId] : [])];
        // If login failed after bootstrap, find ONLY this run's exact randomized admin name.
        if (!adminId) {
          const [r] = await rows<{ ID: string }>(connection, "SELECT id FROM s2_users WHERE username = :name", { name: adminName });
          if (r) ids.push(r.ID);
        }
        for (const id of ids) await connection.execute("DELETE FROM s2_users WHERE id = :id", { id });
        for (const key of limitKeys) await connection.execute("DELETE FROM s2_login_limits WHERE key_hash = :key", { key });
      });
    } finally { await pool.close(10); }
  }
});
