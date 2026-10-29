import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink, unlink, rename, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalWorkspace, decodeFile, terminalEnvironment } from '../../src/main/workspace';
import { applyWorkspaceEdits } from '../../../../packages/shared-types/workspace-text';
import { parseWorkspaceRequest, relativeWorkspacePath, WORKSPACE_LIMITS, type WorkspaceEvent } from '../../../../packages/shared-types/workspace';

let root: string; let outside: string; let workspace: LocalWorkspace; let id: string;
let events: WorkspaceEvent[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-unit-')); outside = await mkdtemp(join(tmpdir(), 'workspace-outside-'));
  events = []; workspace = new LocalWorkspace(e => events.push(e)); id = (await workspace.select(root)).id;
});
afterEach(async () => { workspace.dispose(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });

describe('workspace boundaries and lifecycle', () => {
  it('rejects path injection, alternate streams, reserved names and invalid IPC shapes', () => {
    for (const path of ['../x', '/x', 'a/../x', 'a\\x', 'C:/x', '//host/x', '\\\\?\\C:\\x', 'a:b', 'a//b', 'CON.txt', 'a.', 'x\0', '.git/config', 'node_modules/x']) expect(() => relativeWorkspacePath(path)).toThrow();
    expect(() => relativeWorkspacePath('src/한글 file.ts')).not.toThrow();
    for (const request of [null, [], {}, { action: 'constructor' }, { action: 'read', id, path: '../x' }, { action: 'pick', root }, { action: 'terminal-resize', id, terminal: id, cols: 10000, rows: 20 }, { action: 'dirty', id, dirty: 'yes' }]) expect(() => parseWorkspaceRequest(request)).toThrow();
  });
  it('lists one directory, excludes defaults and rejects stale handles', async () => {
    await mkdir(join(root, 'src')); await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'a.txt'), 'hello');
    expect((await workspace.list(id, '')).map(e => e.name)).toEqual(['src', 'a.txt']);
    const old = id; id = (await workspace.select(outside)).id;
    await expect(workspace.read(old, 'a.txt')).rejects.toThrow();
    workspace.dispose(); await expect(workspace.list(id, '')).rejects.toThrow();
  });
  it('blocks junction/symlink traversal for reads and saves', async () => {
    await writeFile(join(outside, 'private.txt'), 'outside');
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await workspace.list(id, '')).find(e => e.name === 'escape')?.blocked).toBe(true);
    await expect(workspace.read(id, 'escape/private.txt')).rejects.toThrow();
    await expect(workspace.save(id, 'escape/private.txt', 'changed', 'a'.repeat(64), true)).rejects.toThrow();
    expect(await readFile(join(outside, 'private.txt'), 'utf8')).toBe('outside');
    await expect(workspace.select(join(root, 'escape'))).rejects.toThrow();
  });
  it('blocks hard links and discards a selection completed after disposal', async () => {
    await writeFile(join(outside, 'private.txt'), 'outside'); await link(join(outside, 'private.txt'), join(root, 'hard.txt'));
    await expect(workspace.read(id, 'hard.txt')).rejects.toThrow('하드 링크');
    const pending = workspace.select(outside); workspace.dispose();
    await expect(pending).rejects.toThrow('만료'); expect(workspace.info).toBeNull();
  });
});
describe('text reads and replacement saves', () => {
  it('preserves UTF-8 BOM and CRLF including Korean text', async () => {
    await writeFile(join(root, 'a.ts'), '\ufeffconst value = "한글";\r\n');
    const file = await workspace.read(id, 'a.ts');
    expect(file).toMatchObject({ bom: true, eol: 'CRLF', text: 'const value = "한글";\r\n' });
    const saved = await workspace.save(id, 'a.ts', '수정\n다음\n', file.version, false);
    expect(saved.conflict).toBe(false);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('\ufeff수정\r\n다음\r\n');
    expect((await workspace.list(id, '')).some(e => e.name.startsWith('.local-ai-save-'))).toBe(false);
  });
  it('preserves CR and mixed newlines through Monaco edit offsets', async () => {
    await writeFile(join(root, 'cr.txt'), 'one\rtwo\r'); const cr = await workspace.read(id, 'cr.txt');
    await workspace.save(id, 'cr.txt', 'ONE\ntwo\n', cr.version, false);
    expect(await readFile(join(root, 'cr.txt'), 'utf8')).toBe('ONE\rtwo\r');
    await writeFile(join(root, 'mixed.txt'), 'one\r\ntwo\n'); const mixed = await workspace.read(id, 'mixed.txt');
    const edited = applyWorkspaceEdits(mixed.text, [{ rangeOffset: 4, rangeLength: 3, text: 'TWO' }]);
    expect(edited).toBe('one\r\nTWO\n');
    await workspace.save(id, 'mixed.txt', edited, mixed.version, false);
    expect(await readFile(join(root, 'mixed.txt'), 'utf8')).toBe('one\r\nTWO\n');
  });
  it('detects changed versions even for explicit overwrites; never recreates deleted files', async () => {
    await writeFile(join(root, 'a.txt'), 'original'); const original = await workspace.read(id, 'a.txt');
    await writeFile(join(root, 'a.txt'), 'external');
    const conflict = await workspace.save(id, 'a.txt', 'mine', original.version, false);
    expect(conflict.conflict).toBe(true); expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('external');
    expect((await workspace.save(id, 'a.txt', 'mine', original.version, true)).conflict).toBe(true);
    const current = await workspace.read(id, 'a.txt');
    expect((await workspace.save(id, 'a.txt', 'mine', current.version, true)).conflict).toBe(false);
    await unlink(join(root, 'a.txt'));
    expect(await workspace.save(id, 'a.txt', 'mine', current.version, true)).toEqual({ conflict: true, disk: null });
  });
  it('rejects binary, invalid UTF-8 and oversized files', async () => {
    for (const [name, bytes] of [['binary', Buffer.from([0, 1, 2])], ['utf16', Buffer.from([0xff, 0xfe, 65, 0])], ['large', Buffer.alloc(WORKSPACE_LIMITS.bytes + 1, 65)]] as const) {
      await writeFile(join(root, name), bytes); await expect(workspace.read(id, name)).rejects.toThrow();
    }
    expect(() => decodeFile('utf8', Buffer.from([0xc3, 0x28]))).toThrow('UTF-8');
  });
  it('leaves a read-only file untouched on failed save', async () => {
    const path = join(root, 'readonly.txt'); await writeFile(path, 'original'); await chmod(path, 0o444);
    try { const file = await workspace.read(id, 'readonly.txt'); await expect(workspace.save(id, 'readonly.txt', 'mine', file.version, false)).rejects.toThrow('읽기 전용'); expect(await readFile(path, 'utf8')).toBe('original'); }
    finally { await chmod(path, 0o666); }
  });
});
describe('watchers and terminal environment', () => {
  it('reports root deletion and stops resources while retaining the handle for explicit close', async () => {
    await rm(root, { recursive: true, force: true });
    await expect.poll(() => events.some(e => e.type === 'lost'), { timeout: 5000 }).toBe(true);
    await expect(workspace.list(id, '')).rejects.toThrow();
  });
  it('debounces create/modify/rename/delete, excludes hidden dirs, stops after dispose', async () => {
    await workspace.list(id, '');
    await writeFile(join(root, 'a.txt'), '1'); await writeFile(join(root, 'a.txt'), '2');
    await expect.poll(() => events.some(e => e.type === 'change')).toBe(true);
    events.length = 0; await rename(join(root, 'a.txt'), join(root, 'b.txt'));
    await expect.poll(() => events.some(e => e.type === 'change')).toBe(true);
    events.length = 0; await unlink(join(root, 'b.txt'));
    await expect.poll(() => events.some(e => e.type === 'change')).toBe(true);
    workspace.dispose(); events.length = 0; await writeFile(join(root, 'c.txt'), '3');
    await new Promise(resolve => setTimeout(resolve, 300)); expect(events).toEqual([]);
  });
  it('filters secrets and app settings from the shell environment', () => {
    expect(terminalEnvironment({ Path: 'safe', SystemRoot: 'windows', OPENAI_API_KEY: 'sentinel', AUTH_SERVER_URL: 'sentinel', APP_TOKEN: 'sentinel', NODE_OPTIONS: 'sentinel', ELECTRON_RUN_AS_NODE: '1' })).toEqual({ Path: 'safe', SystemRoot: 'windows' });
  });
});
