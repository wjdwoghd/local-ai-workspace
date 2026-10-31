import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { GitSession, runGitProcess } from '../../src/main/git';
import { LocalWorkspace } from '../../src/main/workspace';
import { parseGitRequest, containsSecret, type GitApproval, type GitIntent, type GitView, type GitFileDiff, type GitCommitFiles } from '../../../../packages/shared-types/git';
vi.setConfig({ testTimeout: 30000 });

let root: string; let workspace: LocalWorkspace; let id: string; let session: number; let git: GitSession;
const guard = vi.fn(async () => {}); const audit = vi.fn(async () => {});
const command = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const intent = (operation: GitIntent['operation'], files: string[] = []): GitIntent => ({ operation, files, message: 'feat: selected file', base: 'main', title: 'Change', body: 'Purpose and validation' });
const prepare = async (i: GitIntent) => await git.execute({ action: 'prepare', id, intent: i }, guard, audit) as GitApproval;
const decide = (p: GitApproval, accept = true) => git.execute({ action: 'decide', id, token: p.token, digest: p.digest, accept }, guard, audit);
const stage = async (files: string[]) => decide(await prepare(intent('stage', files)));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-stage7-')); workspace = new LocalWorkspace(() => {}); id = (await workspace.select(root)).id; session = 1;
  command('init', '-b', 'main'); command('config', 'user.name', 'Test User'); command('config', 'user.email', 'test@example.invalid');
  command('config', 'core.quotepath', 'false');
  git = new GitSession(workspace, () => session, async (exe, args, cwd, input) => { if (exe === 'gh') throw new Error('not connected'); return runGitProcess(exe, args, cwd, input); });
  guard.mockClear(); audit.mockClear();
});
afterEach(async () => { workspace.dispose(); await rm(root, { recursive: true, force: true }); });
it('validates IPC, pathspec injection and secret-bearing inputs', () => {
  for (const path of ['../x', ':x', '--all', '.env', 'a/.env.dev', 'dist/a.js', 'id_rsa.key']) expect(() => parseGitRequest({ action: 'diff', id, path })).toThrow();
  for (const raw of [{ action: 'status', id, cwd: root }, { action: 'prepare', id, intent: { ...intent('stage'), files: ['.'] } }, { action: 'decide', id, token: id, digest: 'x', accept: true }]) expect(() => parseGitRequest(raw)).toThrow();
  expect(containsSecret('ghp_' + 'a'.repeat(32))).toBe(true);
  for(const raw of [{action:'commit-diff',id,commit:'HEAD',path:'file.txt'},{action:'diff',id,path:'file.txt',staged:'yes'},{action:'prepare',id,intent:{...intent('checkout'),base:'--detach'}},{action:'prepare',id,intent:{...intent('create-branch'),base:'a..b'}}])expect(()=>parseGitRequest(raw)).toThrow();
});
it('separates staged and working copies and exposes only safe committed file previews',async()=>{
  await writeFile(join(root,'file.txt'),'original\n');command('add','--','file.txt');command('commit','-m','initial');
  await writeFile(join(root,'file.txt'),'staged\n');command('add','--','file.txt');await writeFile(join(root,'file.txt'),'working\n');
  const index=await git.execute({action:'diff',id,path:'file.txt',staged:true},guard,audit) as GitFileDiff;
  const work=await git.execute({action:'diff',id,path:'file.txt',staged:false},guard,audit) as GitFileDiff;
  expect(index).toMatchObject({original:'original\n',modified:'staged\n'});expect(work).toMatchObject({original:'staged\n',modified:'working\n'});
  command('commit','-m','staged change');const head=command('rev-parse','HEAD').trim();
  const files=await git.execute({action:'commit-files',id,commit:head},guard,audit) as GitCommitFiles;expect(files.files).toEqual([{path:'file.txt',status:'M',blocked:false}]);
  const preview=await git.execute({action:'commit-diff',id,commit:head,path:'file.txt'},guard,audit);expect(preview).toMatchObject({original:'original\n',modified:'staged\n'});
  expect(await readFile(join(root,'file.txt'),'utf8')).toBe('working\n');
});
it('returns actual merge parents and branch refs without a GitHub request during local status',async()=>{
  await writeFile(join(root,'base.txt'),'base');command('add','--','base.txt');command('commit','-m','base');command('switch','-c','feature');
  await writeFile(join(root,'feature.txt'),'feature');command('add','--','feature.txt');command('commit','-m','feature work');command('switch','main');
  await writeFile(join(root,'main.txt'),'main');command('add','--','main.txt');command('commit','-m','main work');command('merge','--no-ff','feature','-m','merge feature');
  const runner=vi.fn(async(exe:string,args:string[],cwd:string,input?:string,signal?:AbortSignal)=>{if(exe==='gh')throw new Error('must not query network');return runGitProcess(exe,args,cwd,input,signal);});
  const reader=new GitSession(workspace,()=>session,runner);const view=await reader.execute({action:'status',id},guard,audit) as GitView;
  expect(view.history[0]).toMatchObject({subject:'merge feature'});expect(view.history[0].parents).toHaveLength(2);expect(view.history.some(c=>c.refs.includes('feature'))).toBe(true);expect(view.branchHeads.main).toBe(view.head);
  expect(runner.mock.calls.some(([exe])=>exe==='gh')).toBe(false);
  const files=await reader.execute({action:'commit-files',id,commit:view.head},guard,audit) as GitCommitFiles;expect(files.files.some(f=>f.path==='feature.txt')).toBe(true);
});
it('creates and switches branches only after current approval and keeps dirty files untouched',async()=>{
  await writeFile(join(root,'file.txt'),'base');command('add','--','file.txt');command('commit','-m','base');
  const created=await prepare({...intent('create-branch'),base:'feature/new'});expect(command('branch','--show-current').trim()).toBe('main');await decide(created);expect(command('branch','--show-current').trim()).toBe('feature/new');expect(audit).toHaveBeenCalledWith('create-branch','succeeded');
  await expect(prepare({...intent('create-branch'),base:'feature'})).rejects.toThrow('이름 경로');
  await decide(await prepare({...intent('checkout'),base:'main'}));expect(command('branch','--show-current').trim()).toBe('main');
  await writeFile(join(root,'file.txt'),'unsaved work');await expect(prepare({...intent('checkout'),base:'feature/new'})).rejects.toThrow('변경');expect(await readFile(join(root,'file.txt'),'utf8')).toBe('unsaved work');
  command('add','--','file.txt');command('commit','-m','second');
  const stale=await prepare({...intent('checkout'),base:'feature/new'});command('branch','-f','feature/new','main');await expect(decide(stale)).rejects.toThrow('변경');expect(command('branch','--show-current').trim()).toBe('main');
});
it('reads actual status/branch/diff and stages, unstages, commits only selected files', async () => {
  await writeFile(join(root, '선택.txt'), 'first'); await writeFile(join(root, 'other.txt'), 'keep');
  const view = await git.execute({ action: 'status', id }, guard, audit) as GitView;
  expect(view.branch).toBe('main'); expect(view.changes).toHaveLength(2); expect(view.github).toBeNull();
  expect(await git.execute({ action: 'diff', id, path: '선택.txt' }, guard, audit)).toMatchObject({ kind:'file-diff',original:'',modified:'first',diff:'first' });
  await stage(['선택.txt']); expect(command('diff', '--cached', '--name-only')).toContain('선택.txt'); expect(command('diff', '--cached', '--name-only')).not.toContain('other.txt');
  await decide(await prepare(intent('unstage', ['선택.txt']))); expect(command('diff', '--cached', '--name-only')).toBe('');
  expect(await readFile(join(root, '선택.txt'), 'utf8')).toBe('first');
  await stage(['선택.txt']); const p = await prepare(intent('commit')); expect(p.diff).toContain('+first'); await decide(p);
  expect(command('log', '-1', '--format=%s').trim()).toBe('feat: selected file'); expect(command('ls-tree', '--name-only', 'HEAD')).not.toContain('other.txt');
  expect(audit).toHaveBeenCalledWith('commit', 'succeeded');
  await expect(decide(p)).rejects.toThrow('승인');
});
it('preserves files and rejects stale, modified, denied or cross-session approvals', async () => {
  await writeFile(join(root, 'file.txt'), 'one');
  const p = await prepare(intent('stage', ['file.txt'])); await writeFile(join(root, 'file.txt'), 'two');
  await expect(decide(p)).rejects.toThrow('변경'); expect(command('diff', '--cached', '--name-only')).toBe('');
  const rejected = await prepare(intent('stage', ['file.txt'])); await decide(rejected, false); expect(command('diff', '--cached', '--name-only')).toBe('');
  const changed = await prepare(intent('stage', ['file.txt'])); session++;
  await expect(decide(changed)).rejects.toThrow('승인');
  const expired = await prepare(intent('stage', ['file.txt'])); const now = vi.spyOn(Date, 'now').mockReturnValue(expired.expires + 1);
  await expect(decide(expired)).rejects.toThrow('승인'); now.mockRestore();
  const disposed = await prepare(intent('stage', ['file.txt'])); git.dispose(); await expect(decide(disposed)).rejects.toThrow('승인');
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('two');
});
it('blocks secrets even when staged outside the app and requires the audit server before mutation', async () => {
  await writeFile(join(root, '.env'), 'PRIVATE=example'); command('add', '--', '.env'); await expect(prepare(intent('commit'))).rejects.toThrow('차단');
  const unstage = await prepare(intent('unstage', ['.env'])); expect(unstage.diff).not.toContain('PRIVATE='); await decide(unstage);
  expect(await readFile(join(root, '.env'), 'utf8')).toBe('PRIVATE=example'); await writeFile(join(root, 'source.txt'), 'ghp_' + 'b'.repeat(32));
  await expect(prepare(intent('stage', ['source.txt']))).rejects.toThrow('비밀');
  command('add', '--', 'source.txt'); await expect(prepare(intent('commit'))).rejects.toThrow('비밀'); command('rm', '--cached', '--', 'source.txt');
  await writeFile(join(root, 'safe.txt'), 'safe'); const p = await prepare(intent('stage', ['safe.txt']));
  await expect(git.execute({ action: 'decide', id, token: p.token, digest: p.digest, accept: true }, guard, async () => { throw new Error('network'); })).rejects.toThrow('network');
  expect(command('diff', '--cached', '--name-only')).toBe('');
});
it('fails closed for auth failure, missing GitHub, dirty workspaces and external gitdir', async () => {
  await expect(git.execute({ action: 'status', id }, async () => { throw new Error('401'); }, audit)).rejects.toThrow('401');
  command('remote', 'add', 'origin', 'https://github.com/example/repository.git'); await expect(prepare(intent('push'))).rejects.toThrow('GitHub CLI');
  workspace.dirty = true; await expect(prepare(intent('commit'))).rejects.toThrow('저장'); workspace.dirty = false;
  const nested = join(root, 'nested'); await mkdir(nested); const old = id; id = (await workspace.select(nested)).id;
  await expect(git.execute({ action: 'status', id: old }, guard, audit)).rejects.toThrow(); await expect(git.execute({ action: 'status', id }, guard, audit)).rejects.toThrow();
});
it('reports actual merge conflicts without changing conflict content', async () => {
  await writeFile(join(root, 'file.txt'), 'base\n'); command('add', '--', 'file.txt'); command('commit', '-m', 'base'); command('checkout', '-b', 'feature');
  await writeFile(join(root, 'file.txt'), 'feature\n'); command('commit', '-am', 'feature'); command('checkout', 'main'); await writeFile(join(root, 'file.txt'), 'main\n'); command('commit', '-am', 'main');
  expect(() => command('merge', 'feature')).toThrow(); const content = await readFile(join(root, 'file.txt'), 'utf8');
  const view = await git.execute({ action: 'status', id }, guard, audit) as GitView; expect(view.conflicts).toBe(true);
  await expect(prepare(intent('commit'))).rejects.toThrow('충돌'); expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe(content);
});
it('reviews remote diff, pins push destination, preserves work on network/permission failure, creates PR without implicit push', async () => {
  await writeFile(join(root, 'safe.txt'), 'safe\n'); command('add', '--', 'safe.txt'); command('commit', '-m', 'base');
  const head = command('rev-parse', 'HEAD').trim(); command('remote', 'add', 'origin', 'https://github.com/example/repository.git');
  let published = false; let failure = ''; const calls: string[][] = [];
  git = new GitSession(workspace, () => session, async (exe, args, cwd, input, signal) => {
    calls.push([exe, ...args]);
    if (exe === 'gh') {
      if (args[0] === 'api') return 'test-user\n';
      expect(args).toContain('--head'); expect(args).toContain('--body-file'); expect(input).toBe('Purpose and validation');
      return 'https://github.com/example/repository/pull/42\n';
    }
    if (args.includes('ls-remote')) return published ? `${head}\trefs/heads/${args.at(-1)?.slice('refs/heads/'.length)}\n` : '';
    if (args.includes('fetch')) { await writeFile(join(root, '.git', 'FETCH_HEAD'), head + '\n'); return ''; }
    if (args.includes('push')) { if (failure) throw new Error(failure); published = true; return 'ok'; }
    return runGitProcess(exe, args, cwd, input, signal);
  });
  const p = await prepare(intent('push')); expect(p.diff).toContain('+safe'); expect(p.commits).toContain('새 브랜치');
  failure = '네트워크 연결 실패'; await expect(decide(p)).rejects.toThrow('네트워크'); expect(command('rev-parse', 'HEAD').trim()).toBe(head); expect(audit).toHaveBeenCalledWith('push', 'failed');
  failure = '인증 실패 또는 권한 거부'; await expect(decide(await prepare(intent('push')))).rejects.toThrow('권한');
  failure = ''; await decide(await prepare(intent('push')));
  const push = calls.find(c => c.includes('push'))!; expect(push).toContain('https://github.com/example/repository.git'); expect(push).toContain('HEAD:refs/heads/main'); expect(push).not.toContain('--force');
  expect(await decide(await prepare(intent('pr')))).toMatchObject({ url: 'https://github.com/example/repository/pull/42' });
});
it('refuses outbound history containing deleted secrets and remote URL rewriting', async () => {
  await writeFile(join(root, 'leaked.txt'), 'ghp_' + 'z'.repeat(32)); command('add', '--', 'leaked.txt'); command('commit', '-m', 'leaked'); command('rm', '--', 'leaked.txt'); command('commit', '-m', 'removed');
  command('remote', 'add', 'origin', 'https://github.com/example/repository.git');
  git = new GitSession(workspace, () => session, (exe, args, cwd, input, signal) => exe === 'gh' ? Promise.resolve('test-user\n') : runGitProcess(exe, args, cwd, input, signal));
  await expect(prepare(intent('push'))).rejects.toThrow('비밀정보');
  command('config', 'url.https://elsewhere.invalid/.insteadOf', 'https://github.com/'); await expect(prepare(intent('push'))).rejects.toThrow('재작성');
});
it('pulls a reviewed fast-forward and preserves divergent local work on rejection', async () => {
  await writeFile(join(root, 'safe.txt'), 'base\n'); command('add', '--', 'safe.txt'); command('commit', '-m', 'base');
  command('checkout', '-b', 'incoming'); await writeFile(join(root, 'safe.txt'), 'incoming\n'); command('commit', '-am', 'incoming');
  let target = command('rev-parse', 'HEAD').trim(); command('checkout', 'main'); command('remote', 'add', 'origin', 'https://github.com/example/repository.git');
  git = new GitSession(workspace, () => session, async (exe, args, cwd, input, signal) => {
    if (exe === 'gh') return 'test-user\n';
    if (args.includes('ls-remote')) return `${target}\trefs/heads/main\n`;
    if (args.includes('fetch')) { await writeFile(join(root, '.git', 'FETCH_HEAD'), target + "\t\tbranch 'main' of https://github.com/example/repository\n"); return ''; }
    return runGitProcess(exe, args, cwd, input, signal);
  });
  const p = await prepare(intent('pull')); expect(p.diff).toContain('+incoming'); await decide(p); expect(command('rev-parse', 'HEAD').trim()).toBe(target);
  command('checkout', 'incoming'); await writeFile(join(root, 'safe.txt'), 'remote next\n'); command('commit', '-am', 'remote next'); target = command('rev-parse', 'HEAD').trim(); command('checkout', 'main');
  await writeFile(join(root, 'safe.txt'), 'local next\n'); command('commit', '-am', 'local next'); const before = command('rev-parse', 'HEAD').trim();
  const divergent = await prepare(intent('pull')); await expect(decide(divergent)).rejects.toThrow('충돌'); expect(command('rev-parse', 'HEAD').trim()).toBe(before); expect(await readFile(join(root, 'safe.txt'), 'utf8')).toMatch(/local next/);
});
it('does not bypass a failing commit hook or expose its output', async () => {
  await writeFile(join(root, 'safe.txt'), 'safe'); await stage(['safe.txt']);
  await writeFile(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "PRIVATE_HOOK_OUTPUT" >&2\nexit 1\n', { mode: 0o755 });
  await expect(decide(await prepare(intent('commit')))).rejects.toThrow('hook');
  expect(command('diff', '--cached', '--name-only').trim()).toBe('safe.txt'); expect(command('status', '--porcelain')).toContain('A  safe.txt');
});
