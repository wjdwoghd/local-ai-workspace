import { expect, it, vi } from 'vitest';
import { AuthClient } from '../../src/main/auth-client';
import { randomUUID } from 'node:crypto';
const input = { id: randomUUID(), text: 'hello', model: 'gpt-6-astra' };
const credential = 'x'.repeat(43);
const loginResponse = () => Response.json({ ok: true, data: { credential, user: { id: 'alice' } } });
it('streams through main, keeps bearer out of events, rejects truncated output', async () => {
  const transport = vi.fn().mockResolvedValueOnce(loginResponse()).mockResolvedValueOnce(new Response('data: {"type":"delta","text":"한글"}\n\ndata: {"type":"done"}\n\n')).mockResolvedValueOnce(new Response('data: {"type":"delta","text":"partial"}\n\n'));
  const client = new AuthClient('https://example.com/api/action', transport);
  const emit = vi.fn();
  expect(await client.stream(input, emit)).toMatchObject({ status: 401 });
  await client.execute({ action: 'login', username: 'alice', password: 'password' });
  expect(await client.stream(input, emit)).toMatchObject({ ok: true });
  expect(emit.mock.calls).toEqual([[{ type: 'delta', text: '한글' }], [{ type: 'done' }]]);
  expect(JSON.stringify(emit.mock.calls)).not.toContain(credential);
  expect(new Headers(transport.mock.calls[1][1].headers).get('Authorization')).toBe(`Bearer ${credential}`);
  expect(await client.stream(input, emit)).toMatchObject({ ok: false });
});
it('logout aborts in-flight stream and never emits later content', async () => {
  const transport = vi.fn().mockResolvedValueOnce(loginResponse()).mockImplementationOnce(async (_url, options) => new Response(new ReadableStream({ start(c) { options.signal.addEventListener('abort', () => c.error(new Error('aborted'))); } }))).mockResolvedValueOnce(Response.json({ ok: true, data: null }));
  const client = new AuthClient('https://example.com/api/action', transport);
  await client.execute({ action: 'login', username: 'alice', password: 'password' });
  const emit = vi.fn(); const task = client.stream(input, emit);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  await client.execute({ action: 'logout' });
  expect(await task).toMatchObject({ ok: false }); expect(emit).not.toHaveBeenCalled();
});
