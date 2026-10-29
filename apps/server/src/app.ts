import Fastify from "fastify";
import { InputError, parseOperation } from "../../../packages/shared-types/auth";
import { ApiError, audit } from "./security";
import type { service } from "./service";
import { parseChat } from '../../../packages/shared-types/chat';
import type { chat } from './chat';
import { Readable } from 'node:stream';
import { parseSearchOperation, parseUpload, MAX_FILE_BYTES } from '../../../packages/shared-types/search';
import type { documents } from './documents';
export function app(auth: Pick<ReturnType<typeof service>, "execute">, ai?: ReturnType<typeof chat>, docs?: ReturnType<typeof documents>) {
  // Never enable request logging: credentials are in the authorization header / login body.
  // No trustProxy: X-Forwarded-* supplied by clients must not bypass limits.
  const server = Fastify({ logger: false, bodyLimit: 32768, requestTimeout: 20000, connectionTimeout: 20000 });
  server.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Strict-Transport-Security", "max-age=31536000");
  });
  server.setErrorHandler((error, _request, reply) => {
    const status = error instanceof ApiError ? error.status : error instanceof InputError ? 400 :
      (error as { statusCode?: number }).statusCode === 413 ? 413 :
      (error as { statusCode?: number }).statusCode === 400 ? 400 : 503;
    if (status === 503) audit("request_failed");
    reply.code(status).send({ ok: false, status, message: error instanceof ApiError || error instanceof InputError ? error.message : "요청을 처리할 수 없습니다. 잠시 후 다시 시도하세요." });
  });
  server.post("/api/action", async (request, reply) => {
    const op = parseOperation(request.body);
    const header = request.headers.authorization;
    const credential = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const search = parseSearchOperation(op as unknown as Record<string, unknown>);
    if (search && !docs) throw new ApiError(503, '문서 검색 설정이 필요합니다.');
    try { return { ok: true, data: search ? await docs!.execute(search, credential) : await auth.execute(op, credential, request.ip) }; }
    catch (error) { if (error instanceof ApiError && error.status === 429) reply.header("Retry-After", "900"); throw error; }
  });
  server.post('/api/documents', { bodyLimit: Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4096 }, async request => {
    if (!docs) throw new ApiError(503, '문서 검색 설정이 필요합니다.');
    const header = request.headers.authorization;
    const credential = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    return { ok: true, data: await docs.upload(parseUpload(request.body), credential) };
  });
  server.post('/api/chat', async (request, reply) => {
    const input = parseChat(request.body);
    if (!ai) throw new ApiError(503, 'AI 서비스 설정이 필요합니다.');
    const header = request.headers.authorization;
    const credential = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const run = await ai.start(input, credential);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const close = () => controller.abort();
    reply.raw.once('close', close);
    async function* body() {
      try {
        for await (const event of run.events(controller.signal)) {
          yield `data: ${JSON.stringify(event)}\n\n`;
        }
      } finally { clearTimeout(timeout); reply.raw.off('close', close); controller.abort(); }
    }
    return reply.type('text/event-stream').header('X-Accel-Buffering', 'no').send(Readable.from(body()));
  });
  server.setNotFoundHandler((_request, reply) => reply.code(404).send({ ok: false, status: 404, message: "리소스를 찾을 수 없습니다." }));
  return server;
}
