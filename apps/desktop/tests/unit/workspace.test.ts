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
  it('searches real project text and names while excluding secrets, binary, hard links and junctions', async () => {
    await mkdir(join(root, 'src')); await writeFile(join(root, 'src', '한국어.ts'), 'first\nneedle 한글\n');
    await writeFile(join(root, '.env'), 'needle'); await writeFile(join(root, 'password.txt'), 'needle');
    await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist', 'output.txt'), 'needle');
    await writeFile(join(root, 'binary.bin'), Buffer.from([0,110,101,101,100,108,101]));
    await writeFile(join(outside, 'outside.txt'), 'needle'); await link(join(outside, 'outside.txt'), join(root, 'hard.txt'));
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const found = await workspace.search(id, 'NEEDLE');
    expect(found.hits).toEqual([{ path: 'src/한국어.ts', line: 2, text: 'needle 한글' }]);
    expect(found.limited).toBe(false);
    expect((await workspace.search(id, '한국어')).hits[0].path).toBe('src/한국어.ts');
    expect(() => parseWorkspaceRequest({ action: 'search', id, query: '' })).toThrow();
    expect(() => parseWorkspaceRequest({ action: 'search', id, query: 'x', root: outside })).toThrow();
    workspace.dispose(); await expect(workspace.search(id, 'needle')).rejects.toThrow();
  });
  it('caps search results and rejects arbitrary shell executables and arguments', async () => {
    await writeFile(join(root, 'many.txt'), 'match\n'.repeat(200));
    const result = await workspace.search(id, 'match'); expect(result.hits).toHaveLength(100);
    for (const request of [{action:'terminal-start',id,shell:'cmd'}, {action:'terminal-start',id,shell:'C:/malware.exe'}, {action:'terminal-start',id,shell:'git-bash',args:['-c','echo secret']}]) expect(()=>parseWorkspaceRequest(request)).toThrow();
    expect(parseWorkspaceRequest({action:'terminal-start',id,shell:'git-bash'})).toMatchObject({shell:'git-bash'});
    await expect(workspace.terminalStart(id, 'invalid' as never)).rejects.toThrow();
  });
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
describe('Explorer file operations',()=>{
  it('creates folders and empty Unicode files exclusively without replacing existing data',async()=>{
    await workspace.create(id,'새 폴더',true);await workspace.create(id,'새 폴더/hello.py',false);
    expect(await readFile(join(root,'새 폴더','hello.py'),'utf8')).toBe('');
    await writeFile(join(root,'새 폴더','hello.py'),'original');
    await expect(workspace.create(id,'새 폴더/hello.py',false)).rejects.toThrow('이미');
    await expect(workspace.create(id,'새 폴더',true)).rejects.toThrow('이미');
    expect(await readFile(join(root,'새 폴더','hello.py'),'utf8')).toBe('original');
    expect(events.some(e=>e.type==='change'&&e.directory==='새 폴더')).toBe(true);
  });
  it('renames files and folders, rejects collisions and dirty state, and retains content',async()=>{
    await workspace.create(id,'src',true);await writeFile(join(root,'src','a.py'),'keep');await writeFile(join(root,'src','b.py'),'other');
    await expect(workspace.renameEntry(id,'src/a.py','src/b.py')).rejects.toThrow('이미');
    workspace.dirty=true;await expect(workspace.renameEntry(id,'src/a.py','src/c.py')).rejects.toThrow('저장');workspace.dirty=false;
    await expect(workspace.renameEntry(id,'src','src/child')).rejects.toThrow('하위');
    await workspace.renameEntry(id,'src/a.py','src/c.py');await workspace.renameEntry(id,'src','source');
    expect(await readFile(join(root,'source','c.py'),'utf8')).toBe('keep');expect(await readFile(join(root,'source','b.py'),'utf8')).toBe('other');
  });
  it('validates new destinations, stale handles and session changes before any mutation',async()=>{
    for(const request of [{action:'create',id,path:'../escape',directory:false},{action:'create',id,path:'x',directory:'yes'},{action:'rename',id,path:'x',target:'C:/escape'},{action:'trash',id,path:''},{action:'trash',id,path:'.git'},{action:'find-paths',id,query:''}])expect(()=>parseWorkspaceRequest(request)).toThrow();
    await expect(workspace.create(id,'x',false,()=>{throw new Error('expired');})).rejects.toThrow('expired');
    expect((await workspace.list(id,'')).map(e=>e.name)).not.toContain('x');
    const old=id;id=(await workspace.select(outside)).id;await expect(workspace.create(old,'x',false)).rejects.toThrow();
  });
  it('rejects junction destinations and hard links for rename and trash',async()=>{
    await symlink(outside,join(root,'escape'),process.platform==='win32'?'junction':'dir');
    await writeFile(join(root,'a.py'),'safe');await expect(workspace.create(id,'escape/new.py',false)).rejects.toThrow();
    await expect(workspace.renameEntry(id,'a.py','escape/new.py')).rejects.toThrow();
    await writeFile(join(outside,'target.py'),'outside');await link(join(outside,'target.py'),join(root,'hard.py'));
    await expect(workspace.renameEntry(id,'hard.py','new.py')).rejects.toThrow('하드 링크');
    let called=false;await expect(workspace.trash(id,'hard.py',async()=>{called=true;})).rejects.toThrow('하드 링크');expect(called).toBe(false);
    expect(await readFile(join(outside,'target.py'),'utf8')).toBe('outside');
  });
  it('sends only the verified project path to the recycle callback and never deletes on refusal',async()=>{
    await writeFile(join(root,'a.txt'),'safe');let called='';
    workspace.dirty=true;await expect(workspace.trash(id,'a.txt',async()=>{called='unexpected';})).rejects.toThrow('저장');workspace.dirty=false;
    await expect(workspace.trash(id,'a.txt',async()=>{throw new Error('trash unavailable');})).rejects.toThrow('trash unavailable');
    expect(await readFile(join(root,'a.txt'),'utf8')).toBe('safe');
    await workspace.trash(id,'a.txt',async absolute=>{called=absolute;await rename(absolute,join(root,'recycled.txt'));});
    expect(called).toBe(join(root,'a.txt'));expect(await readFile(join(root,'recycled.txt'),'utf8')).toBe('safe');
  });
  it('finds filenames without reading binary contents and bounds results',async()=>{
    await mkdir(join(root,'nested'));await writeFile(join(root,'nested','image-match.bin'),Buffer.from([0,1]));await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','hidden-match.txt'),'hidden');
    expect((await workspace.findPaths(id,'MATCH')).matches.map(e=>e.path)).toEqual(['nested/image-match.bin']);
    for(let i=0;i<205;i++)await writeFile(join(root,`match-${i}.txt`),'');
    const found=await workspace.findPaths(id,'match');expect(found.matches).toHaveLength(200);expect(found.limited).toBe(true);
  });
});

describe('watchers and terminal environment', () => {
  it('Windows recursive root watch notices changes inside unopened nested folders and ignores Git internals',async()=>{
    if(process.platform!=='win32')return;
    await mkdir(join(root,'src','nested'),{recursive:true});await mkdir(join(root,'.git'));await new Promise(r=>setTimeout(r,200));events.length=0;
    await writeFile(join(root,'src','nested','created.py'),'first');
    await expect.poll(()=>events.some(e=>e.type==='change'&&e.directory==='src/nested')).toBe(true);
    await new Promise(r=>setTimeout(r,250));events.length=0;await writeFile(join(root,'.git','index'),'ignored');await new Promise(r=>setTimeout(r,350));expect(events).toEqual([]);
  });
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
