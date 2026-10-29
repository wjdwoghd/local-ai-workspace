import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalWorkspace } from '../../src/main/workspace';
import { AgentSession } from '../../src/main/agent';
import { agentPath, parseAgentRequest } from '../../../../packages/shared-types/agent';
let root: string, workspace: LocalWorkspace, agent: AgentSession, id: string, session: number;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'stage6-')); workspace = new LocalWorkspace(() => {}); id = (await workspace.select(root)).id; session = 1; agent = new AgentSession(workspace, () => session); await writeFile(join(root, 'a.ts'), 'before'); });
afterEach(async () => { vi.useRealTimers(); agent.dispose(); workspace.dispose(); await rm(root, { recursive: true, force: true }); });
async function proposal(mode: 'ask' | 'edit' | 'agent' = 'edit') { await agent.analyze(id, mode, ['a.ts']); const file = await workspace.read(id, 'a.ts'); return agent.propose(agent.currentScope!, [{ path: file.path, before: file.text, version: file.version, after: 'after' }]); }
it('blocks secrets, traversal and arbitrary IPC fields', () => {
  for (const path of ['.env', '.env.local', '.git/config', 'node_modules/a', '../a', 'C:/a', 'a\\b', 'secret.json', 'key.pem', '.ssh/id_rsa']) expect(() => agentPath(path)).toThrow();
  for (const raw of [{ action: 'exec', id, mode: 'agent' }, { action: 'status', id, mode: 'ask', command: 'echo x' }, { action: 'analyze', id, mode: 'edit', paths: ['a.ts', 'a.ts'] }]) expect(() => parseAgentRequest(raw)).toThrow();
});
it('local analysis stores only metadata; start never implies real connection', async () => {
  expect((await agent.analyze(id, 'ask', ['a.ts'])).files).toHaveLength(1);
  expect(JSON.stringify(agent.audit)).not.toContain('before'); expect(agent.start(id, 'agent').state).toBe('setup-required');
  expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('before');
});
it('Ask blocks proposals and all modes have no command capability', async () => {
  await expect(proposal('ask')).rejects.toThrow('모드');
  expect('terminalWrite' in agent).toBe(false); expect('exec' in agent).toBe(false);
});
it('does not write before approval; binds digest and consumes approval once', async () => {
  const p = (await proposal()).approval!;
  expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('before');
  await expect(agent.decide(id, 'edit', p.id, '0'.repeat(64), true)).rejects.toThrow();
  p.changes[0].after = 'tampered renderer';
  const result = await agent.decide(id, 'edit', p.id, p.digest, true);
  expect(result.applied).toEqual(['a.ts']); expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('after');
  await expect(agent.decide(id, 'edit', p.id, p.digest, true)).rejects.toThrow();
});
it('reject and expiry cause no side effects', async () => {
  let p = (await proposal()).approval!; await agent.decide(id, 'edit', p.id, p.digest, false);
  await expect(agent.decide(id, 'edit', p.id, p.digest, true)).rejects.toThrow();
  p = (await proposal()).approval!; vi.spyOn(Date, 'now').mockReturnValue(p.expires + 1);
  await expect(agent.decide(id, 'edit', p.id, p.digest, true)).rejects.toThrow(); vi.restoreAllMocks();
  expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('before');
});
it('checks external and unsaved edit conflicts immediately before apply', async () => {
  let p = (await proposal()).approval!; await writeFile(join(root, 'a.ts'), 'external');
  expect((await agent.decide(id, 'edit', p.id, p.digest, true)).state).toBe('failed');
  expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('external');
  p = (await proposal()).approval!; workspace.dirty = true;
  expect((await agent.decide(id, 'edit', p.id, p.digest, true)).state).toBe('failed');
  await expect(proposal()).rejects.toThrow();
});
it.each(['session', 'mode', 'stop', 'dispose', 'project'] as const)('invalidates old approval after %s', async action => {
  const p = (await proposal()).approval!;
  if (action === 'session') session++;
  if (action === 'mode') agent.status(id, 'ask');
  if (action === 'stop') agent.stop(id, 'edit');
  if (action === 'dispose') agent.dispose();
  if (action === 'project') await workspace.select(root);
  await expect(agent.decide(id, 'edit', p.id, p.digest, true)).rejects.toThrow();
  expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('before');
});
it('rejects hard links and junctions during agent reads and limits file sizes', async () => {
  await link(join(root, 'a.ts'), join(root, 'hard.ts'));
  expect((await agent.analyze(id, 'ask', ['hard.ts'])).state).toBe('failed');
  await symlink(root, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await agent.analyze(id, 'ask', ['escape/a.ts'])).state).toBe('failed');
  await writeFile(join(root, 'large.ts'), 'a'.repeat(262145));
  expect((await agent.analyze(id, 'ask', ['large.ts'])).state).toBe('failed');
});
it('reports partial application without claiming rollback', async () => {
  await writeFile(join(root, 'b.ts'), 'second'); await agent.analyze(id, 'agent', ['a.ts', 'b.ts']);
  const changes = await Promise.all(['a.ts', 'b.ts'].map(async path => { const file = await workspace.read(id, path); return { path, before: file.text, after: 'new', version: file.version }; }));
  const p = (await agent.propose(agent.currentScope!, changes)).approval!;
  await writeFile(join(root, 'b.ts'), 'external'); const result = await agent.decide(id, 'agent', p.id, p.digest, true);
  expect(result).toMatchObject({ state: 'failed', applied: ['a.ts'], unapplied: ['b.ts'] });
  expect(await readFile(join(root, 'b.ts'), 'utf8')).toBe('external');
});
it('late analysis after stop cannot restore old state', async () => {
  const read = workspace.read.bind(workspace); let release!: () => void;
  vi.spyOn(workspace, 'read').mockImplementation(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return read(...args); });
  const pending = agent.analyze(id, 'ask', ['a.ts']); agent.stop(id, 'ask'); release();
  await expect(pending).rejects.toThrow('만료'); expect(agent.status(id, 'ask').state).toBe('interrupted');
});
it.each(['stop', 'session', 'mode'] as const)('queued apply checks %s again before any write', async action => {
  const p = (await proposal()).approval!; const save = workspace.save.bind(workspace); let release!: () => void;
  vi.spyOn(workspace, 'save').mockImplementation(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return save(...args); });
  const pending = agent.decide(id, 'edit', p.id, p.digest, true);
  if (action === 'stop') agent.stop(id, 'edit');
  if (action === 'session') { session++; agent.dispose(); }
  if (action === 'mode') agent.status(id, 'ask');
  release(); await expect(pending).rejects.toThrow('만료');
  expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('before');
});
