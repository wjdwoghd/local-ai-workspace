import { expect, it, vi } from 'vitest';
import type oracledb from 'oracledb';
import { service } from '../../src/service';
import { config } from '../../src/config';
import { token, verifyPassword } from '../../src/security';
import { parseOperation, username } from '../../../../packages/shared-types/auth';

it('allows Korean names for login and keeps regular password creation policy', () => {
  expect(username('홍길동')).toBe('홍길동'); expect(username('TEAM.01')).toBe('team.01');
  expect(parseOperation({ action: 'login', username: '홍길동', password: 'a'.repeat(4) })).toMatchObject({ username: '홍길동' });
  for (const name of ['가'.repeat(22), '홍 길동', '../관리자', '<script>', 'x']) expect(() => username(name)).toThrow();
  expect(() => parseOperation({ action: 'createUser', username: '홍길동', password: 'a'.repeat(4), role: 'user' })).toThrow();
});
it('creates only ordinary users with independently salted hashes, without plaintext persistence', async () => {
  const inserts: Record<string, string>[] = [];
  const execute = vi.fn(async (sql: string, binds?: Record<string, string>) => {
    if (sql.startsWith('SELECT version')) return { rows: [{ VERSION: 4 }] };
    if (sql.startsWith('INSERT')) inserts.push(binds!);
    return { rows: [] };
  });
  const transaction = async <T>(work: (c: oracledb.Connection) => Promise<T>) => work({ execute } as unknown as oracledb.Connection);
  const settings = config({ SESSION_SECRET: token(), ORACLE_USER: 'fixture', ORACLE_PASSWORD: token(), ORACLE_CONNECT_STRING: 'fixture' });
  const api = service({ transaction }, settings); const initial = 'a'.repeat(4);
  const accounts = await api.provisionUsers(['홍길동', '김테스트'], initial);
  expect(accounts.every(u => u.role === 'user' && u.active)).toBe(true);
  expect(inserts).toHaveLength(2); expect(inserts[0].hash).not.toBe(inserts[1].hash);
  for (const record of inserts) { expect(record).not.toHaveProperty('password'); expect(await verifyPassword(initial, record.hash)).toBe(true); }
  await expect(api.provisionUsers(['홍길동', '홍길동'], initial)).rejects.toMatchObject({ status: 400 });
});
it('rejects an existing account before any insertion, without password resets', async () => {
  const execute = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT version') ? [{ VERSION: 4 }] : [{ ID: 'existing' }] }));
  const transaction = async <T>(work: (c: oracledb.Connection) => Promise<T>) => work({ execute } as unknown as oracledb.Connection);
  const settings = config({ SESSION_SECRET: token(), ORACLE_USER: 'fixture', ORACLE_PASSWORD: token(), ORACLE_CONNECT_STRING: 'fixture' });
  await expect(service({ transaction }, settings).provisionUsers(['홍길동'], 'a'.repeat(4))).rejects.toMatchObject({ status: 409 });
  expect(execute.mock.calls.some(([sql]) => /INSERT|UPDATE s2_users/.test(sql))).toBe(false);
});
