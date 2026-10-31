import { mkdir, lstat, realpath, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, parse, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseOperation, username, type Result, type Theme, type User } from '../../../../packages/shared-types/auth';
import type { Activity } from '../../../../packages/shared-types/collaboration';
import { parseLocalProfileRequest, type LocalProfile, type LocalProfileRequest, type LocalProfileView } from '../../../../packages/shared-types/local-profile';
import type { ChatEvent } from '../../../../packages/shared-types/chat';
import type { UploadInput } from '../../../../packages/shared-types/search';
import type { LocalAIClient } from './local-ai-client';

interface State { theme: Theme; roots: string[]; activity: Activity[] }
const fresh = (): State => ({ theme: 'system', roots: [], activity: [] });
const inside = (base: string, file: string) => { const r = relative(base, file); return !r || r !== '..' && !r.startsWith('..\\') && !r.startsWith('../') && !isAbsolute(r); };
const overlap = (a: string, b: string) => inside(a, b) || inside(b, a);
async function directory(full: string) {
  let cursor = parse(full).root;
  for (const part of relative(cursor, full).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    await mkdir(cursor).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const s = await lstat(cursor);
    if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) throw new Error('링크가 없는 로컬 프로필 폴더가 필요합니다.');
  }
}
async function readJSON(file: string): Promise<unknown | undefined> {
  try {
    const s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 1024 * 1024) throw new Error('프로필 파일의 형식·크기를 확인하세요.');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
}
async function atomic(file: string, value: unknown) {
  await directory(dirname(file));
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
}
export class LocalProfiles {
  readonly base: string;
  sessionGeneration = 0;
  private profiles: LocalProfile[] = [];
  private active: LocalProfile | null = null;
  private state = fresh();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(base: string, private changed: () => void = () => {}, readonly ai?: LocalAIClient) { this.base = resolve(base); }
  get hasSession() { return !!this.active; }
  private serial<T>(work: () => Promise<T>): Promise<T> { const task = this.queue.catch(() => {}).then(work); this.queue = task; return task; }
  private folder(id: string) { return join(this.base, id); }
  get homeDirectory() { if (!this.active) throw new Error('작업 공간을 선택하세요.'); return join(this.folder(this.active.id), 'project'); }
  async initialize(roster?: string) {
    await directory(this.base);
    const value = await readJSON(join(this.base, 'profiles.json'));
    if (value !== undefined) {
      if (!Array.isArray(value) || value.length > 100 || value.some(p => !p || typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id) || typeof p.name !== 'string' || username(p.name) !== p.name) || new Set(value.map(p => p.id)).size !== value.length || new Set(value.map(p => p.name)).size !== value.length) throw new Error('프로필 목록이 손상되었습니다. 원본 파일은 보존했습니다.');
      this.profiles = value;
    } else {
      if (roster) {
        if (!isAbsolute(roster)) throw new Error('명단은 로컬 파일의 절대 경로여야 합니다.');
        const names = await readJSON(roster);
        if (!Array.isArray(names) || names.length > 100) throw new Error('로컬 명단 형식을 확인하세요.');
        const normalized = names.map(username);
        if (new Set(normalized).size !== normalized.length) throw new Error('명단 이름이 중복되었습니다.');
        this.profiles = normalized.map(name => ({ id: randomUUID(), name }));
      }
      await atomic(join(this.base, 'profiles.json'), this.profiles);
    }
  }
  private view(): LocalProfileView { return structuredClone({ profiles: this.profiles, active: this.active, theme: this.active ? this.state.theme : 'system', directory: this.active ? this.homeDirectory : null }); }
  private async load(id: string): Promise<State> {
    await directory(this.folder(id));
    const file = join(this.folder(id), 'state.json'); const value = await readJSON(file) as State | undefined;
    if (value === undefined) return fresh();
    if (!value || !['light', 'dark', 'system'].includes(value.theme) || !Array.isArray(value.roots) || value.roots.length > 100 || value.roots.some(r => typeof r !== 'string' || !isAbsolute(r) || r.length > 4096) || !Array.isArray(value.activity) || value.activity.length > 100 || value.activity.some(a => !a || typeof a.id !== 'string' || !/^git\.(stage|unstage|commit|push|pull|pr|checkout|create-branch)$/.test(a.action) || !['started', 'succeeded', 'failed'].includes(a.outcome) || typeof a.time !== 'string')) throw new Error('개인 설정 파일이 손상되었습니다. 원본 파일은 보존했습니다.');
    return value;
  }
  private async persist(state: State) { if (!this.active) throw new Error('작업 공간을 선택하세요.'); await atomic(join(this.folder(this.active.id), 'state.json'), state); this.state = state; }
  profilesRequest(raw: LocalProfileRequest): Promise<LocalProfileView> {
    const request = parseLocalProfileRequest(raw);
    if(request.action==='select'||request.action==='leave')this.ai?.setProfile(null);
    return this.serial(async () => {
      if (request.action === 'create') {
        if (this.profiles.length >= 100 || this.profiles.some(p => p.name === request.name)) throw new Error('이미 있는 이름이거나 프로필 한도(100개)입니다.');
        const next = [...this.profiles, { id: randomUUID(), name: request.name }];
        await atomic(join(this.base, 'profiles.json'), next); this.profiles = next;
      } else if (request.action === 'select' || request.action === 'leave') {
        const next = request.action === 'select' ? this.profiles.find(p => p.id === request.id) : null;
        if (request.action === 'select' && !next) throw new Error('없는 프로필입니다.');
        this.sessionGeneration++; this.active = null; this.state = fresh(); this.changed();
        if (next) { await directory(join(this.folder(next.id), 'project')); const state = await this.load(next.id); this.active = next; this.state = state; this.ai?.setProfile(next.id); }
      }
      return this.view();
    });
  }
  claimProject(root: string, generation = this.sessionGeneration): Promise<string> {
    return this.serial(async () => {
      if (!this.active || generation !== this.sessionGeneration) throw new Error('프로필이 변경되었습니다.');
      const actual = await realpath(resolve(root));
      if (overlap(this.base, actual) && !inside(this.homeDirectory, actual)) throw new Error('다른 프로필 또는 프로필 설정 폴더는 열 수 없습니다.');
      for (const profile of this.profiles.filter(p => p.id !== this.active!.id)) {
        const state = await this.load(profile.id);
        if (state.roots.some(r => overlap(r, actual))) throw new Error('다른 팀원에게 연결된 프로젝트입니다. 개인 복사본을 선택하세요.');
      }
      if (!this.state.roots.includes(actual)) {
        if (this.state.roots.length >= 100) throw new Error('개인별 프로젝트 연결 한도(100개)입니다.');
        await this.persist({ ...this.state, roots: [...this.state.roots, actual] });
      }
      return actual;
    });
  }
  execute(raw: unknown): Promise<Result> {
    let op; try { op = parseOperation(raw); } catch { return Promise.resolve({ ok: false, status: 400, message: '잘못된 요청입니다.' }); }
    const generation = this.sessionGeneration;
    const remote=['chatStatus','conversations','createConversation','getConversation','messages','updateConversation','deleteConversation'];
    if(this.active&&this.ai&&remote.includes(op.action))return this.ai.execute(op).then(result=>generation===this.sessionGeneration&&this.active?result:{ok:false,status:401,message:'프로필이 변경되었습니다.'});
    return this.serial(async (): Promise<Result> => {
      if (!this.active || generation !== this.sessionGeneration) return { ok: false, status: 401, message: '로컬 작업 공간을 선택하세요.' };
      switch (op.action) {
        case 'me': return { ok: true, data: { id: this.active.id, username: this.active.name, role: 'user', active: true } satisfies User };
        case 'settings': return { ok: true, data: { theme: this.state.theme } };
        case 'saveSettings': await this.persist({ ...this.state, theme: op.theme }); return { ok: true, data: null };
        case 'activity': return { ok: true, data: structuredClone(this.state.activity).reverse() };
        case 'recordGit':
          await this.persist({ ...this.state, activity: [...this.state.activity, { id: randomUUID(), action: `git.${op.operation}`, outcome: op.outcome, time: new Date().toISOString() }].slice(-100) }); return { ok: true, data: null };
        case 'chatStatus': case 'conversations': case 'createConversation': case 'getConversation': case 'messages': case 'updateConversation': case 'deleteConversation':
          if(op.action==='chatStatus')return{ok:true,data:{configured:false,models:[],message:'로컬 API 서버 미연결'}};
        default: return { ok: false, status: 503, message: '로컬 작업 공간 모드에서는 서버 기능을 사용하지 않습니다.' };
      }
    });
  }
  cancelChat() {this.ai?.cancelChat();}
  async stream(raw: unknown, emit: (event: ChatEvent) => void): Promise<Result> { if(this.active&&this.ai)return this.ai.stream(raw,emit);return { ok: false, status: 503, message: '로컬 API 서버를 연결하세요.' }; }
  async importDocument(_pick: () => Promise<UploadInput | undefined>): Promise<Result> { return { ok: false, status: 503, message: '로컬 모드에서는 서버 문서 등록을 사용하지 않습니다.' }; }
}
