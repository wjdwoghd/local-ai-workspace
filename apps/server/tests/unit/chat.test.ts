import { expect, it, vi } from 'vitest';
import { openai } from '../../src/openai';
import { chat } from '../../src/chat';
import { ApiError } from '../../src/security';
import { parseChat } from '../../../../packages/shared-types/chat';
import { sse } from '../../../../packages/shared-types/sse';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app';
import type { chatStore } from '../../src/chat-store';
const input = { id: randomUUID(), text: '다음 질문', model: 'gpt-6-astra' };
const config = { openaiKey: 'test-only-placeholder', models: [{ id: input.model, label: 'Astra' }] };
const signal = () => new AbortController().signal;
const eventStream = (events: unknown[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const collect = async <T>(source: AsyncIterable<T>) => { const a: T[] = []; for await (const x of source) a.push(x); return a; };

it('does not contact OpenAI with an empty key or an unapproved model', async () => {
  const transport = vi.fn();
  await expect(collect(openai({ ...config, openaiKey: '' }, transport).stream(input, [], signal()))).rejects.toMatchObject({ status: 503 });
  await expect(collect(openai(config, transport).stream({ ...input, model: 'forged' }, [], signal()))).rejects.toMatchObject({ status: 400 });
  expect(transport).not.toHaveBeenCalled();
});
it('checks exact account model access before sending only selected conversation context', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ id: input.model })).mockResolvedValueOnce(eventStream([
    { type: 'response.output_text.delta', delta: '안녕' }, { type: 'response.output_text.delta', delta: '하세요' },
    { type: 'response.completed', response: { status: 'completed' } },
  ]));
  const messages = [{ id: randomUUID(), role: 'assistant' as const, text: '이 대화의 답변', model: input.model }];
  expect(await collect(openai(config, transport).stream(input, messages, signal()))).toEqual(['안녕', '하세요']);
  expect(transport.mock.calls[0][0]).toBe(`https://api.openai.com/v1/models/${input.model}`);
  const body = JSON.parse(transport.mock.calls[1][1].body);
  expect(body).toMatchObject({ model: input.model, stream: true, store: false, input: [{ role: 'assistant', content: messages[0].text }, { role: 'user', content: input.text }] });
  expect(body).not.toHaveProperty('previous_response_id');
});
it('rejects denied access before transmitting chat content and sanitizes provider errors', async () => {
  const transport = vi.fn().mockResolvedValue(new Response('upstream secret body', { status: 403 }));
  await expect(collect(openai(config, transport).stream(input, [], signal()))).rejects.toThrow('모델 접근 권한');
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each(['response.failed', 'response.incomplete', 'error', 'truncated'])('rejects %s without saving a partial answer', async type => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ id: input.model })).mockResolvedValueOnce(eventStream([
    { type: 'response.output_text.delta', delta: '미완료' }, ...(type === 'truncated' ? [] : [{ type }]),
  ]));
  const store = { check: vi.fn(), prepare: vi.fn().mockResolvedValue({ run: 'run', messages: [] }), finish: vi.fn(), release: vi.fn(async () => {}) };
  const run = await chat(store, openai(config, transport)).start(input, 'credential');
  const events = await collect(run.events(signal()));
  expect(events.at(-1)).toMatchObject({ type: 'error' }); expect(store.finish).not.toHaveBeenCalled(); expect(store.release).toHaveBeenCalled();
});
it('rejects forged input fields and ownership before model/config/provider access', async () => {
  expect(() => parseChat({ ...input, owner: 'someone' })).toThrow();
  expect(() => parseChat({ ...input, text: ' ' })).toThrow();
  const store = { check: vi.fn().mockRejectedValue(new ApiError(404, 'missing')), prepare: vi.fn(), finish: vi.fn(), release: vi.fn(async () => {}) };
  const provider = { validate: vi.fn(), stream: vi.fn() };
  await expect(chat(store, provider).start(input, 'other')).rejects.toMatchObject({ status: 404 });
  expect(provider.validate).not.toHaveBeenCalled(); expect(store.prepare).not.toHaveBeenCalled();
});
it('reauthenticates during streaming and never saves after session revocation', async () => {
  const store = { check: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new ApiError(401, 'expired')), prepare: vi.fn().mockResolvedValue({ run: 'run', messages: [] }), finish: vi.fn(), release: vi.fn(async () => {}) };
  const provider = { validate: vi.fn(), async *stream() { yield 'private'; } };
  const run = await chat(store, provider).start(input, 'old');
  expect(await collect(run.events(signal()))).toEqual([{ type: 'error', status: 401, message: 'expired' }]);
  expect(store.finish).not.toHaveBeenCalled();
});
it('commits before done and releases after cancellation/save failures', async () => {
  const order: string[] = [];
  const store = { check: vi.fn(), prepare: vi.fn().mockResolvedValue({ run: 'run', messages: [] }), finish: vi.fn(async () => { order.push('saved'); }), release: vi.fn(async () => {}) };
  const provider = { validate: vi.fn(), async *stream() { yield '완료'; } };
  const run = await chat(store, provider).start(input, 'credential');
  for await (const event of run.events(signal())) if (event.type === 'done') order.push('done');
  expect(order).toEqual(['saved', 'done']);
  store.finish.mockClear(); const controller = new AbortController(); controller.abort();
  const cancelled = await chat(store, provider).start(input, 'credential');
  expect((await collect(cancelled.events(controller.signal))).at(-1)).toMatchObject({ type: 'error' });
  expect(store.finish).not.toHaveBeenCalled();
});
it('decodes one-byte Korean UTF-8 chunks, CRLF frames and SSE comments', async () => {
  const bytes = new TextEncoder().encode(': ping\r\ndata: {"text":"한글"}\r\n\r\ndata: {"text":"다음"}\r\n\r\n');
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  expect(await collect(sse(stream))).toEqual([{ text: '한글' }, { text: '다음' }]);
});
it('serves authenticated SSE with no buffering/cache and hides unexpected errors', async () => {
  const store: ReturnType<typeof chatStore> = { check: vi.fn(async (_id, credential) => { if (credential !== 'valid') throw new ApiError(401, '로그인 필요'); }), prepare: vi.fn().mockResolvedValue({ run: 'r', messages: [] }), finish: vi.fn(), release: vi.fn(async () => {}) };
  const server = app({ execute: vi.fn() }, chat(store, { validate() {}, async *stream() { yield '안녕'; } }));
  try {
    expect((await server.inject({ method: 'POST', url: '/api/chat', payload: input })).statusCode).toBe(401);
    const response = await server.inject({ method: 'POST', url: '/api/chat', payload: { ...input, text: '한'.repeat(4000) }, headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['x-accel-buffering']).toBe('no');
    expect(response.body).toContain('안녕'); expect(response.body).toContain('"type":"done"');
  } finally { await server.close(); }
});
