// Explicit UI test fixture only. Production server always uses Oracle and never imports this file.
import { createServer } from "node:http";
import { createServer as createTLSServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { parseOperation, type ConversationMeta, type User, type Theme } from "../../../../../packages/shared-types/auth";
import { parseChat, type ChatMessage } from '../../../../../packages/shared-types/chat';
import { parseUpload, type Citation, type DocumentMeta } from '../../../../../packages/shared-types/search';
export async function authFixture(ai = false, tls?: { cert: string; key: string }) {
  const password = randomBytes(24).toString("hex");
  const users = ["alice", "bob", "admin"].map(username => ({ id: randomUUID(), username, role: username === "admin" ? "admin" : "user", active: true } as User));
  const sessions = new Map<string, User>();
  const settings = new Map<string, Theme>();
  const chats = new Map<string, { owner: string; meta: ConversationMeta }>();
  const messages = new Map<string, ChatMessage[]>();
  const contexts: string[][] = [];
  const documents = new Map<string, DocumentMeta & { text: string }>();
  const server = tls ? createTLSServer({ cert: await readFile(tls.cert), key: await readFile(tls.key) }) : createServer();
  server.on('request', async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const send = (status: number, data?: unknown) => { res.statusCode = status; res.end(JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, status })); };
    try {
      let text = "";
      for await (const chunk of req) text += chunk;
      if (req.url === '/api/documents') {
        const input = parseUpload(JSON.parse(text));
        const user = sessions.get(req.headers.authorization?.slice(7) || '');
        if (!user) return send(401);
        const doc = { id: randomUUID(), name: input.name, owner: user.id, teamId: null, chunks: 1, text: Buffer.from(input.base64, 'base64').toString('utf8') };
        documents.set(doc.id, doc); return send(200, doc);
      }
      if (req.url === '/api/chat') {
        const input = parseChat(JSON.parse(text));
        const user = sessions.get(req.headers.authorization?.slice(7) || '');
        if (!user) return send(401);
        const c = chats.get(input.id);
        if (c?.owner !== user.id) return send(404);
        if (!ai) return send(503);
        const history = messages.get(input.id) ?? [];
        contexts.push([...history.map(m => m.text), input.text]);
        res.setHeader('Content-Type', 'text/event-stream');
        const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        emit({ type: 'delta', text: '테스트 ' });
        await new Promise(resolve => setTimeout(resolve, input.text === '중단 테스트' ? 500 : 80));
        if (res.destroyed) return;
        const citations: Citation[] = [];
        const doc = [...documents.values()].find(d => d.owner === user.id);
        if (input.documentSearch && doc) citations.push({ kind: 'document', title: `[D1] ${doc.name}`, documentId: doc.id, chunk: 1, location: '줄 1' });
        const answer = citations.length ? '테스트 스트리밍 응답 [D1] 공식' : '테스트 스트리밍 응답';
        if (input.webSearch || input.autoTools) citations.push({ kind: 'web', title: '공식 출처', url: 'https://example.com/policy', start: answer.length - 2, end: answer.length });
        emit({ type: 'delta', text: answer.slice(4) });
        if (citations.length) emit({ type: 'sources', citations });
        messages.set(input.id, [...history, { id: randomUUID(), role: 'user', text: input.text, model: input.model }, { id: randomUUID(), role: 'assistant', text: answer, model: input.model, ...(citations.length ? { citations } : {}) }]);
        if (!history.length) c.meta.title = input.text.slice(0, 28);
        emit({ type: 'done' }); res.end(); return;
      }
      const op = parseOperation(JSON.parse(text));
      if (op.action === "login") {
        const u = users.find(u => u.username === op.username && op.password === password);
        if (!u) return send(401);
        const credential = randomBytes(32).toString("base64url"); sessions.set(credential, u);
        return send(200, { user: u, credential });
      }
      const credential = req.headers.authorization?.slice(7) || "";
      const u = sessions.get(credential);
      if (!u) return send(401);
      switch (op.action) {
        case 'activity': return send(200, []);
        case 'myUsage': return send(200, { records: 0, input: null, output: null, total: null, cost: null, scope: '테스트 fixture · 수집 없음' });
        case 'recordGit': return send(200, null);
        case 'shareDocument': {
          const doc = documents.get(op.id); if (doc?.owner !== u.id) return send(404);
          if (op.teamId) return send(403);
          return send(200, null);
        }
        case 'teams': return send(200, []);
        case 'documents': return send(200, [...documents.values()].filter(d => d.owner === u.id));
        case 'searchDocuments': return send(200, [...documents.values()].filter(d => d.owner === u.id && d.text.includes(op.query)).map(d => ({ documentId: d.id, name: d.name, chunk: 1, location: '줄 1', text: d.text })));
        case 'readDocument': {
          const d = documents.get(op.id); if (d?.owner !== u.id) return send(404);
          return send(200, { ...d, parts: [{ chunk: 1, location: '줄 1', text: d.text }] });
        }
        case 'deleteDocument': if (documents.get(op.id)?.owner !== u.id) return send(404); documents.delete(op.id); return send(200, null);
        case 'chatStatus': return send(200, { configured: ai, models: [{ id: 'gpt-6-astra', label: 'Astra' }], message: ai ? '테스트 서버' : '서버 API 키 설정이 필요합니다.' });
        case 'messages': if (chats.get(op.id)?.owner !== u.id) return send(404); return send(200, messages.get(op.id) ?? []);
        case 'getConversation': if (chats.get(op.id)?.owner !== u.id) return send(404); return send(200, chats.get(op.id)!.meta);
        case "me": return send(200, u);
        case "logout": sessions.delete(credential); return send(200, null);
        case "settings": return send(200, { theme: settings.get(u.id) || "system" });
        case "saveSettings": settings.set(u.id, op.theme); return send(200, null);
        case "conversations": return send(200, [...chats.values()].filter(c => c.owner === u.id).map(c => c.meta));
        case "createConversation": {
          const meta = { id: randomUUID(), title: op.title }; chats.set(meta.id, { owner: u.id, meta }); return send(200, meta);
        }
        case "updateConversation": {
          const c = chats.get(op.id); if (c?.owner !== u.id) return send(404);
          c.meta.title = op.title; return send(200, null);
        }
        case "deleteConversation": if (chats.get(op.id)?.owner !== u.id) return send(404); chats.delete(op.id); return send(200, null);
        case "users": return u.role === "admin" ? send(200, users) : send(403);
        default: return send(400);
      }
    } catch { send(400); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `${tls ? 'https' : 'http'}://127.0.0.1:${(server.address() as AddressInfo).port}`,
    password,
    contexts,
    expire: () => sessions.clear(),
    close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())),
  };
}
export async function login(page: Page, username: string, password: string, demo = true) {
  await page.getByLabel("계정 이름", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByLabel("메시지 입력").waitFor();
  await expectReady(page);
  if (demo) await page.getByLabel('모델 선택', { exact: true }).selectOption('demo');
}
async function expectReady(page: Page) { await page.getByLabel('메시지 입력').waitFor({ state: 'visible' }); await page.waitForFunction(() => !(document.getElementById('message') as HTMLTextAreaElement)?.disabled); }
