import { watch, type FSWatcher } from 'node:fs';
import { open, lstat, realpath, opendir, rename, unlink, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, basename, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn as spawnProcess } from 'node:child_process';
import * as pty from 'node-pty';
import { WORKSPACE_HIDDEN, WORKSPACE_LIMITS, relativeWorkspacePath, type WorkspaceEvent, type WorkspaceFile, type WorkspaceInfo, type WorkspaceEntry, type SaveResult } from '../../../../packages/shared-types/workspace';

const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function terminalEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  // Deliberate allowlist: never inherit app credentials, server settings or arbitrary env.
  const keys = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'USERNAME', 'USERDOMAIN'];
  return Object.fromEntries(Object.entries(source).filter((e): e is [string, string] => e[1] !== undefined && keys.some(k => k.toLowerCase() === e[0].toLowerCase())));
}
export function decodeFile(path: string, bytes: Buffer, identity = ''): WorkspaceFile {
  if (bytes.length > WORKSPACE_LIMITS.bytes) throw new Error('텍스트 파일은 최대 2 MiB까지 열 수 있습니다.');
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes); }
  catch { throw new Error('UTF-8 인코딩만 지원합니다.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('바이너리 파일은 열 수 없습니다.');
  const endings = new Set(text.match(/\r\n|\r|\n/g) ?? []);
  const eol = endings.size > 1 ? 'mixed' : endings.has('\r\n') ? 'CRLF' : endings.has('\r') ? 'CR' : 'LF';
  return { path, text, bom, eol, version: createHash('sha256').update(bytes).update(identity).digest('hex') };
}

export class LocalWorkspace {
  info: WorkspaceInfo | null = null;
  dirty = false;
  private generation = 0;
  private watches = new Map<string, FSWatcher>();
  private debounce = new Map<string, ReturnType<typeof setTimeout>>();
  private health?: ReturnType<typeof setInterval>;
  private terminal?: { id: string; process: pty.IPty };
  private saveQueue: Promise<unknown> = Promise.resolve();
  constructor(private emit: (event: WorkspaceEvent) => void) {}
  private current(id: string) {
    if (!this.info || this.info.id !== id) throw new Error('종료되었거나 다른 사용자의 작업공간입니다.');
    return this.info;
  }
  private async checkedRoot(root: string) {
    if (!isAbsolute(root) || (process.platform === 'win32' && !/^[a-z]:\\/i.test(root))) throw new Error('로컬 드라이브의 폴더를 선택하세요. UNC·장치 경로는 지원하지 않습니다.');
    let cursor = parse(root).root;
    for (const component of relative(cursor, root).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, component);
      const s = await lstat(cursor);
      if (s.isSymbolicLink() || !samePath(await realpath(cursor), cursor)) throw new Error('심볼릭 링크·junction 경로는 지원하지 않습니다.');
    }
    if (!(await stat(root)).isDirectory()) throw new Error('폴더를 찾을 수 없습니다.');
  }
  async select(root: string): Promise<WorkspaceInfo> {
    const epoch = this.generation;
    root = resolve(root);
    await this.checkedRoot(root);
    const dir = await opendir(root); await dir.close();
    if (epoch !== this.generation) throw new Error('작업공간 요청이 만료되었습니다.');
    this.dispose();
    const info = this.info = { id: randomUUID(), root, name: basename(root) || root };
    this.watchDirectory(info.id, '', root);
    this.health = setInterval(() => {
      void this.checkedRoot(root).catch(() => {
        if (this.info === info) { this.emit({ id: info.id, type: 'lost', message: '프로젝트 폴더가 삭제되었거나 연결·접근 권한을 잃었습니다. 편집 내용을 복사한 후 프로젝트를 다시 여세요.' }); this.stopResources(); }
      });
    }, 2000);
    return info;
  }
  async path(id: string, path: string, allowRoot = false) {
    relativeWorkspacePath(path, allowRoot);
    const info = this.current(id);
    await this.checkedRoot(info.root);
    let target = info.root;
    for (const part of path.split('/').filter(Boolean)) {
      target = join(target, part);
      const s = await lstat(target);
      if (s.isSymbolicLink()) throw new Error('심볼릭 링크·junction 접근은 차단됩니다.');
      const actual = await realpath(target);
      const rel = relative(info.root, actual);
      if (!samePath(actual, target) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('작업공간 밖 경로입니다.');
    }
    this.current(id);
    return target;
  }
  private watchDirectory(id: string, path: string, full: string) {
    if (this.watches.has(path)) return;
    if (this.watches.size >= WORKSPACE_LIMITS.watches) throw new Error('감시 폴더 한도(128)에 도달했습니다. 프로젝트를 다시 열거나 새로고침하세요.');
    const notify = () => {
      if (this.info?.id !== id || this.debounce.has(path)) return;
      this.debounce.set(path, setTimeout(() => {
        this.debounce.delete(path);
        if (this.info?.id === id) this.emit({ id, type: 'change', directory: path });
      }, 150));
    };
    const watcher = watch(full, (_type, name) => {
      if (name && (WORKSPACE_HIDDEN.includes(name.toString().toLowerCase()) || name.toString().startsWith('.local-ai-save-'))) return;
      notify();
    });
    watcher.on('error', () => { this.watches.delete(path); watcher.close(); notify(); });
    this.watches.set(path, watcher);
  }
  async list(id: string, path: string): Promise<WorkspaceEntry[]> {
    const full = await this.path(id, path, true);
    const directory = await opendir(full);
    const entries: WorkspaceEntry[] = [];
    for await (const entry of directory) {
      if (WORKSPACE_HIDDEN.includes(entry.name.toLowerCase()) || entry.name.startsWith('.local-ai-save-')) continue;
      if (entries.length === WORKSPACE_LIMITS.entries) throw new Error('폴더당 최대 5,000개 항목까지 지원합니다. 더 작은 폴더를 여세요.');
      const child = path ? `${path}/${entry.name}` : entry.name;
      let blocked = entry.isSymbolicLink();
      try { relativeWorkspacePath(child); } catch { blocked = true; }
      entries.push({ path: child, name: entry.name, directory: entry.isDirectory(), blocked });
    }
    this.current(id);
    this.watchDirectory(id, path, full);
    return entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  async read(id: string, path: string): Promise<WorkspaceFile> {
    const full = await this.path(id, path);
    const handle = await open(full, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > WORKSPACE_LIMITS.bytes) throw new Error('일반 텍스트 파일(최대 2 MiB)만 지원합니다.');
      if (before.nlink > 1) throw new Error('하드 링크 파일 접근은 차단됩니다.');
      // Bounded even when another process grows the file after stat.
      const bytes = Buffer.alloc(WORKSPACE_LIMITS.bytes + 1);
      let size = 0;
      while (size < bytes.length) { const read = await handle.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
      const after = await handle.stat();
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('파일을 읽는 중 변경되었습니다. 다시 읽어 주세요.');
      await this.path(id, path);
      return decodeFile(path, bytes.subarray(0, size), `${after.dev}:${after.ino}:${after.mtimeMs}:${after.ctimeMs}:${after.mode}`);
    } finally { await handle.close(); }
  }
  save(id: string, path: string, text: string, version: string, overwrite: boolean): Promise<SaveResult> {
    const run = this.saveQueue.catch(() => {}).then(() => this.write(id, path, text, version, overwrite));
    this.saveQueue = run;
    return run;
  }
  private async write(id: string, path: string, text: string, version: string, _overwrite: boolean): Promise<SaveResult> {
    // Explicit overwrite still compares the version displayed by the conflict dialog.
    let disk: WorkspaceFile;
    try { disk = await this.read(id, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { conflict: true, disk: null }; throw error; }
    if (disk.version !== version) return { conflict: true, disk };
    const full = await this.path(id, path);
    const mode = (await stat(full)).mode;
    if (!(mode & 0o222)) throw new Error('읽기 전용 파일입니다. 편집 내용은 유지됩니다.');
    const normalized = disk.eol === 'mixed' ? text : text.replace(/\r\n|\r|\n/g, disk.eol === 'CRLF' ? '\r\n' : disk.eol === 'CR' ? '\r' : '\n');
    const buffer = Buffer.from((disk.bom ? '\ufeff' : '') + normalized, 'utf8');
    if (buffer.length > WORKSPACE_LIMITS.bytes) throw new Error('저장할 UTF-8 파일이 2 MiB를 초과합니다.');
    decodeFile(path, buffer);
    const temporary = join(resolve(full, '..'), `.local-ai-save-${randomUUID()}`);
    let handle;
    try {
      handle = await open(temporary, 'wx', mode & 0o777);
      await handle.writeFile(buffer); await handle.sync(); await handle.close(); handle = undefined;
      const latest = await this.read(id, path);
      if (latest.version !== version) return { conflict: true, disk: latest };
      await this.path(id, path);
      // No unlink fallback: replacement failure must leave the original intact.
      await rename(temporary, full);
      this.current(id);
      return { conflict: false, file: await this.read(id, path) };
    } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }
  async terminalStart(id: string): Promise<string> {
    const info = this.current(id);
    await this.path(id, '', true);
    this.terminalStop();
    const terminal = randomUUID();
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const shell = process.platform === 'win32' ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/bash';
    const child = pty.spawn(shell, process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['--noprofile', '--norc'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: info.root, env: terminalEnvironment(process.env),
      useConptyDll: process.platform === 'win32',
    });
    this.terminal = { id: terminal, process: child };
    child.onData(data => { if (this.info?.id === id && this.terminal?.id === terminal) this.emit({ id, type: 'output', terminal, data: data.slice(0, 65536) }); });
    child.onExit(({ exitCode }) => {
      if (this.info?.id === id && this.terminal?.id === terminal) { this.terminal = undefined; this.emit({ id, type: 'exit', terminal, code: exitCode }); }
    });
    return terminal;
  }
  terminalWrite(id: string, terminal: string, data: string) { this.current(id); if (this.terminal?.id !== terminal) throw new Error('종료된 터미널입니다.'); this.terminal.process.write(data); }
  terminalResize(id: string, terminal: string, cols: number, rows: number) { this.current(id); if (this.terminal?.id !== terminal) throw new Error('종료된 터미널입니다.'); this.terminal.process.resize(cols, rows); }
  terminalStop() {
    const child = this.terminal; this.terminal = undefined;
    if (!child) return;
    // taskkill /T covers shell descendants in addition to ConPTY's own cleanup.
    if (process.platform === 'win32') {
      const killer = spawnProcess(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env: terminalEnvironment(process.env) });
      const finish = () => { try { child.process.kill(); } catch { /* Already exited. */ } };
      killer.on('error', finish); killer.on('exit', finish);
      return;
    }
    try { child.process.kill(); } catch { /* Already exited. */ }
  }
  assertCurrent(id: string) { this.current(id); }
  private stopResources() {
    for (const watcher of this.watches.values()) watcher.close(); this.watches.clear();
    for (const timer of this.debounce.values()) clearTimeout(timer); this.debounce.clear();
    clearInterval(this.health); this.health = undefined;
    this.terminalStop();
  }
  dispose() {
    const id = this.info?.id;
    this.generation++;
    this.stopResources(); this.info = null; this.dirty = false;
    if (id) this.emit({ id, type: 'reset' });
  }
}
