import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type oracledb from 'oracledb';
import { collaboration } from '../../src/collaboration';
import { parseOperation, type User } from '../../../../packages/shared-types/auth';
import { tokenUsage } from '../../../../packages/shared-types/collaboration';
import { app } from '../../src/app';
import { ApiError } from '../../src/security';
import { openai } from '../../src/openai';
import { chat } from '../../src/chat';
const user: User = { id: randomUUID(), username: 'alice', role: 'user', active: true };
function fixture(role: User['role'] = 'user') {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const withUser = async <T>(credential: string | undefined, work: (c: oracledb.Connection, user: User) => Promise<T>) => {
    if (credential !== 'valid') throw new ApiError(401, '로그인이 필요합니다.');
    return work({ execute } as unknown as oracledb.Connection, { ...user, role });
  };
  return { api: collaboration({ withUser }), execute };
}
it('rejects forged owners, usage ingestion, invalid actions and unknown fields', () => {
  for (const input of [{ action: 'activity', owner: randomUUID() }, { action: 'myUsage', userId: randomUUID() }, { action: 'recordUsage', total: 100 }, { action: 'recordGit', operation: 'force-push', outcome: 'succeeded' }, { action: 'shareDocument', id: randomUUID(), teamId: '../team' }]) expect(() => parseOperation(input)).toThrow();
  expect(tokenUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })).toEqual({ input: 10, output: 5, total: 15 });
  expect(tokenUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 99 })).toBeUndefined();
});
it('authenticates every operation and restricts personal records to authenticated identity', async () => {
  const { api, execute } = fixture();
  for (const action of ['myUsage', 'activity'] as const) await expect(api.execute({ action })).rejects.toMatchObject({ status: 401 });
  expect(execute).not.toHaveBeenCalled();
  await api.execute({ action: 'activity' }, 'valid');
  expect(execute.mock.calls[0][0]).toContain('WHERE user_id = :owner'); expect(execute.mock.calls[0][1]).toEqual({ owner: user.id });
  execute.mockResolvedValueOnce({ rows: [{ RECORDS: 0, INPUT: null, OUTPUT: null, TOTAL: null }] });
  expect(await api.execute({ action: 'myUsage' }, 'valid')).toMatchObject({ records: 0, total: null, cost: null });
  expect(execute.mock.calls[1][0]).toContain('u.user_id = :owner');
});
it('denies team aggregation to members and nonmember admins, returning totals only for allowed teams', async () => {
  const id = randomUUID(); const f = fixture();
  await expect(f.api.execute({ action: 'teamUsage', id }, 'valid')).rejects.toMatchObject({ status: 403 }); expect(f.execute).not.toHaveBeenCalled();
  const admin = fixture('admin'); await expect(admin.api.execute({ action: 'teamUsage', id }, 'valid')).rejects.toMatchObject({ status: 403 });
  admin.execute.mockResolvedValueOnce({ rows: [{ TEAM_ID: id }] }).mockResolvedValueOnce({ rows: [{ RECORDS: 2, INPUT: 40, OUTPUT: 20, TOTAL: 60 }] });
  expect(await admin.api.execute({ action: 'teamUsage', id }, 'valid')).toMatchObject({ total: 60, cost: null });
  expect(admin.execute.mock.calls.at(-1)?.[0]).toContain('m.team_id = :team AND m.user_id = u.user_id'); expect(admin.execute.mock.calls.at(-1)?.[1]).toEqual({ team: id });
});
it('requires ownership plus current source and destination team membership for visibility changes', async () => {
  const { api, execute } = fixture('admin'); const id = randomUUID(); const teamId = randomUUID();
  await expect(api.execute({ action: 'shareDocument', id, teamId }, 'valid')).rejects.toMatchObject({ status: 404 });
  expect(execute.mock.calls[0][0]).toContain('d.owner_id = :owner'); expect(execute.mock.calls[0][0]).toContain('s4_members');
  execute.mockResolvedValueOnce({ rows: [{ TEAM_ID: null }] }).mockResolvedValueOnce({ rows: [] });
  await expect(api.execute({ action: 'shareDocument', id, teamId }, 'valid')).rejects.toMatchObject({ status: 403 });
  execute.mockResolvedValueOnce({ rows: [{ TEAM_ID: null }] }).mockResolvedValueOnce({ rows: [{ TEAM_ID: teamId }] });
  await api.execute({ action: 'shareDocument', id, teamId }, 'valid');
  expect(execute.mock.calls.at(-2)?.[1]).toEqual({ team: teamId, id, owner: user.id });
  expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({ owner: user.id, action: 'document.shared' });
  execute.mockResolvedValueOnce({ rows: [{ TEAM_ID: teamId }] }).mockResolvedValueOnce({ rows: [{ TEAM_ID: teamId }] }); await api.execute({ action: 'shareDocument', id, teamId: null }, 'valid');
  expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'document.unshared' });
});
it('records actual provider tokens once per run before conversation saving and never invents absent usage', async () => {
  const input = { id: randomUUID(), model: 'configured-test-model', text: 'hello' };
  const events = [{ type: 'response.output_text.delta', delta: 'answer' }, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } } }];
  const transport = vi.fn().mockImplementation(async (url: string) => url.includes('/models/') ? Response.json({ id: input.model }) : new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')));
  const provider = openai({ openaiKey: 'test-placeholder', models: [{ id: input.model, label: 'Astra' }] }, transport);
  const store = { check: vi.fn(), prepare: vi.fn().mockResolvedValue({ run: 'run', messages: [] }), finish: vi.fn(), release: vi.fn(async () => {}) }; const recordUsage = vi.fn();
  const run = await chat(store, provider, undefined, { recordUsage }).start(input, 'valid');
  const output = []; for await (const event of run.events(new AbortController().signal)) output.push(event);
  expect(recordUsage).toHaveBeenCalledExactlyOnceWith(input.id, 'run', input.model, { input: 11, output: 7, total: 18 }, 'valid'); expect(output.at(-1)).toEqual({ type: 'done' });
  const { api, execute } = fixture(); execute.mockResolvedValueOnce({ rows: [{ ID: input.id }] });
  await api.recordUsage(input.id, 'run', input.model, { input: 11, output: 7, total: 18 }, 'valid');
  expect(execute.mock.calls[1][0]).toContain('MERGE INTO s7_usage'); expect(execute.mock.calls[1][1]).toMatchObject({ owner: user.id });
});
it('HTTP does not bypass authentication or expose internal errors', async () => {
  const team = fixture().api; const server = app({ execute: vi.fn() }, undefined, undefined, team);
  try {
    expect((await server.inject({ method: 'POST', url: '/api/action', payload: { action: 'activity' } })).statusCode).toBe(401);
    expect((await server.inject({ method: 'POST', url: '/api/action', payload: { action: 'recordGit', operation: 'push', outcome: 'succeeded', owner: 'other' } })).statusCode).toBe(400);
  } finally { await server.close(); }
});
