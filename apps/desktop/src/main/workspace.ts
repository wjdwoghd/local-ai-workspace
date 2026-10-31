import { watch, type FSWatcher } from 'node:fs';
import { open, lstat, realpath, opendir, rename, unlink, stat, mkdir } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, basename, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn as spawnProcess } from 'node:child_process';
import * as pty from 'node-pty';
import { powershellTheme } from './shell-theme';
import { agentPath } from '../../../../packages/shared-types/agent';
import type { ShellProfile, WorkspaceSearch,WorkspacePaths } from '../../../../packages/shared-types/workspace';
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
  async validateRoot(root: string) { await this.checkedRoot(resolve(root)); }
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
    if(process.platform==='win32'&&path&&this.watches.has(''))return;
    if (this.watches.has(path)) return;
    if (this.watches.size >= WORKSPACE_LIMITS.watches) throw new Error('감시 폴더 한도(128)에 도달했습니다. 프로젝트를 다시 열거나 새로고침하세요.');
    const notify = (directory=path) => {
      if (this.info?.id !== id || this.debounce.has(directory)) return;
      this.debounce.set(directory, setTimeout(() => {
        this.debounce.delete(directory);
        if (this.info?.id === id) this.emit({ id, type: 'change', directory });
      }, 150));
    };
    const recursive=process.platform==='win32'&&!path;
    const watcher = watch(full, {recursive}, (_type, name) => {
      const parts=name?.toString().split(/[\\/]/)||[];
      if(parts.some(part=>WORKSPACE_HIDDEN.includes(part.toLowerCase())||part.startsWith('.local-ai-save-')))return;
      const directory=recursive?parts.slice(0,-1).join('/'):path;
      notify(directory);
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
  private async destination(id:string,path:string){
    relativeWorkspacePath(path);const parts=path.split('/'),name=parts.pop()!;
    const parent=await this.path(id,parts.join('/'),true);
    if(!(await stat(parent)).isDirectory())throw new Error('상위 폴더가 아닙니다.');
    const target=join(parent,name);
    try{await lstat(target);throw new Error('같은 이름의 파일·폴더가 이미 있습니다.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    this.current(id);return target;
  }
  private changed(id:string,path:string){this.emit({id,type:'change',directory:path.split('/').slice(0,-1).join('/')});}
  async create(id:string,path:string,directory:boolean,canWrite:()=>void=()=>{}){
    const target=await this.destination(id,path);canWrite();
    if(directory)await mkdir(target);else{const handle=await open(target,'wx');await handle.close();}
    this.current(id);this.changed(id,path);
  }
  async renameEntry(id:string,path:string,target:string,canWrite:()=>void=()=>{}){
    relativeWorkspacePath(target);if(this.dirty)throw new Error('편집 중인 내용을 저장한 뒤 이름을 변경하세요.');
    if(path===target)return;
    if(target.toLowerCase().startsWith(path.toLowerCase()+'/'))throw new Error('폴더를 자기 하위로 이동할 수 없습니다.');
    const source=await this.path(id,path),destination=await this.destination(id,target),metadata=await lstat(source);
    if(metadata.isFile()&&metadata.nlink>1)throw new Error('하드 링크 파일 접근은 차단됩니다.');
    await this.path(id,path);canWrite();if(this.dirty)throw new Error('편집 내용을 저장하세요.');
    await rename(source,destination);this.current(id);this.releaseWatches(path);this.changed(id,path);this.changed(id,target);
  }
  private releaseWatches(path:string){for(const [directory,watcher]of this.watches)if(directory===path||directory.startsWith(path+'/')){watcher.close();this.watches.delete(directory);}}
  async trash(id:string,path:string,move:(absolute:string)=>Promise<void>,canWrite:()=>void=()=>{}){
    if(this.dirty)throw new Error('편집 중인 내용을 저장한 뒤 삭제하세요.');
    const source=await this.path(id,path),metadata=await lstat(source);
    if(metadata.isFile()&&metadata.nlink>1)throw new Error('하드 링크 파일 접근은 차단됩니다.');
    canWrite();await move(source);this.current(id);this.releaseWatches(path);this.changed(id,path);
  }
  async findPaths(id:string,query:string):Promise<WorkspacePaths>{
    if(!query.trim()||query.length>256)throw new Error('검색어는 1~256자입니다.');
    const result:WorkspacePaths={matches:[],limited:false},needle=query.trim().toLowerCase(),started=Date.now();let count=0;
    const walk=async(path:string,depth:number):Promise<void>=>{
      if(depth>20){result.limited=true;return;}
      const full=await this.path(id,path,true),dir=await opendir(full);
      for await(const entry of dir){
        this.current(id);if(++count>10000||result.matches.length>=200||Date.now()-started>3000){result.limited=true;return;}
        if(entry.isSymbolicLink()||WORKSPACE_HIDDEN.includes(entry.name.toLowerCase())||entry.name.startsWith('.local-ai-save-'))continue;
        const child=path?path+'/'+entry.name:entry.name;try{relativeWorkspacePath(child);}catch{continue;}
        if(entry.isDirectory()){try{await walk(child,depth+1);}catch{this.current(id);}if(result.matches.length>=200)return;}
        else if(entry.isFile()&&child.toLowerCase().includes(needle))result.matches.push({path:child,name:entry.name,directory:false,blocked:false});
      }
    };
    await walk('',0);this.current(id);result.limited ||= result.matches.length>=200;return result;
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
  save(id: string, path: string, text: string, version: string, overwrite: boolean, canWrite: () => void = () => {}): Promise<SaveResult> {
    const run = this.saveQueue.catch(() => {}).then(() => this.write(id, path, text, version, overwrite, canWrite));
    this.saveQueue = run;
    return run;
  }
  private async write(id: string, path: string, text: string, version: string, _overwrite: boolean, canWrite: () => void): Promise<SaveResult> {
    canWrite();
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
      canWrite();
      // No unlink fallback: replacement failure must leave the original intact.
      await rename(temporary, full);
      this.current(id);
      return { conflict: false, file: await this.read(id, path) };
    } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }
  async search(id: string, query: string): Promise<WorkspaceSearch> {
    if (typeof query !== 'string' || !query.trim() || query.length > 256) throw new Error('검색어는 1~256자입니다.');
    const result: WorkspaceSearch = { hits: [], limited: false, scanned: 0 };
    const needle = query.trim().toLowerCase(), started = Date.now(); let bytes = 0, entries = 0;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 20) { result.limited = true; return; }
      const full = await this.path(id, directory, true), dir = await opendir(full);
      for await (const entry of dir) {
        this.current(id);
        if (++entries > 5000 || result.scanned >= 500 || bytes >= 10 * 1024 * 1024 || Date.now() - started > 3000 || result.hits.length >= 100) { result.limited = true; return; }
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        try { agentPath(path); } catch { continue; }
        if (entry.isDirectory()) { await walk(path, depth + 1); if (result.limited) return; }
        else if (entry.isFile()) {
          try {
            const target = await this.path(id, path), s = await stat(target);
            if (s.size > 256 * 1024 || s.nlink !== 1) continue;
            const file = await this.read(id, path); result.scanned++; bytes += Buffer.byteLength(file.text);
            const lines = file.text.split(/\r\n|\r|\n/);
            for (let line = 0; line < lines.length && result.hits.length < 100; line++) if (lines[line].toLowerCase().includes(needle) || (line === 0 && path.toLowerCase().includes(needle))) result.hits.push({ path, line: line + 1, text: lines[line].slice(0, 400) });
          } catch { this.current(id); /* Binary, inaccessible or changed files are skipped. */ }
        }
      }
    };
    await walk('', 0); this.current(id); result.limited ||= result.hits.length >= 100; return result;
  }
  async terminalStart(id: string, profile: ShellProfile = 'powershell'): Promise<string> {
    if (profile !== 'powershell' && profile !== 'git-bash') throw new Error('지원하지 않는 셸입니다.');
    const info = this.current(id);
    await this.path(id, '', true);
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    let shell = process.platform === 'win32' ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/bash';
    if (profile === 'git-bash' && process.platform === 'win32') {
      const candidates = [join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), join(process.env.LOCALAPPDATA || join(systemRoot, 'missing'), 'Programs', 'Git', 'bin', 'bash.exe')];
      shell = '';
      for (const candidate of candidates) { try { if ((await lstat(candidate)).isFile() && samePath(await realpath(candidate), candidate)) { shell = candidate; break; } } catch { /* Try next standard Git for Windows installation. */ } }
      if (!shell) throw new Error('Git Bash가 설치되지 않았습니다. Git for Windows의 기본 설치 경로를 확인하세요.');
    }
    this.current(id); this.terminalStop(); const terminal = randomUUID();
    const env={...terminalEnvironment(process.env),TERM:'xterm-256color',COLORTERM:'truecolor',CLICOLOR:'1',...(profile==='git-bash'||process.platform!=='win32'?{PS1:'\\[\\e[1;36m\\]\\u@\\h \\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ '}:{} )};
    const child = pty.spawn(shell, profile === 'powershell' && process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', powershellTheme] : ['--noprofile', '--norc'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: info.root, env,
      // Use Windows' built-in ConPTY rather than the separately shipped OpenConsole.
      useConptyDll: false,
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
