import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve, delimiter, isAbsolute, relative } from 'node:path';
import { terminalEnvironment, type LocalWorkspace } from './workspace';
import { blockedGitPath, containsSecret, gitPath, gitIndexPath, type GitApproval, type GitIntent, type GitRequest, type GitResult, type GitView } from '../../../../packages/shared-types/git';
import { assertApproval } from '../../../../packages/security/approvals';

type Run = (exe: string, args: string[], cwd: string, input?: string, signal?: AbortSignal) => Promise<string>;
function executable(name: string, cwd: string) {
  if (!['git', 'gh'].includes(name)) throw new Error('허용되지 않은 실행 파일');
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const file = join(directory, process.platform === 'win32' ? `${name}.exe` : name);
    if (!existsSync(file)) continue;
    const actual = realpathSync(file); const rel = relative(cwd, actual);
    if (rel && (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel))) return actual;
  }
  throw new Error('프로젝트 외부에 설치된 Git/GitHub CLI 실행 파일이 필요합니다.');
}
export const runGitProcess: Run = (exe, args, cwd, input, signal) => new Promise((resolveResult, reject) => {
  const env = { ...terminalEnvironment(process.env), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GH_PROMPT_DISABLED: '1', GH_PAGER: '', GIT_PAGER: 'cat', GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0' };
  const child = execFile(executable(exe, cwd), args, { cwd, env, signal, windowsHide: true, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (!error) { resolveResult(stdout); return; }
    // Raw command lines, hook output and credential-helper output never cross IPC or enter logs.
    const detail = String(stderr);
    const reason = /conflict|not possible to fast-forward|non-fast-forward|unmerged|would be overwritten|divergent/i.test(detail) ? '충돌 또는 분기된 이력입니다. 변경을 보존했습니다. 편집기에서 해결 후 새로고침하세요.' : /authentication|credential|403|401|permission denied/i.test(detail) ? '인증 실패 또는 권한 거부입니다. GitHub 연결과 저장소 권한을 확인하세요.' : /resolve host|connect|network|timed out/i.test(detail) ? '네트워크 연결에 실패했습니다. 결과를 새로고침한 후 재시도하세요.' : 'Git/GitHub 실행 실패. 설치·저장소·작성자 설정·hook·권한을 확인하세요. 변경은 자동 복원하지 않습니다.';
    reject(new Error(reason));
  });
  child.stdin?.on('error', () => {}); child.stdin?.end(input);
});
const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const safeDiff = (text: string) => containsSecret(text) ? '[비밀정보 의심 내용: 표시 및 작업 차단]' : text;
export class GitSession {
  private epoch = 0;
  private controller?: AbortController;
  private pending?: { id: string; session: number; snapshot: string; approval: GitApproval; remoteHead?: string; remoteBase?: string };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private workspace: LocalWorkspace, private session: () => number, private run: Run = runGitProcess) {}
  dispose() { this.epoch++; this.pending = undefined; this.controller?.abort(); }
  private async root(id: string) {
    const root = await this.workspace.path(id, '', true);
    const meta = await lstat(join(root, '.git'));
    if (!meta.isDirectory() || meta.isSymbolicLink()) throw new Error('선택한 폴더가 저장소 루트여야 합니다. 외부 gitdir·worktree는 지원하지 않습니다.');
    if (resolve((await this.git(root, ['rev-parse', '--show-toplevel'])).trim()).toLowerCase() !== root.toLowerCase()) throw new Error('다른 저장소 경로');
    return root;
  }
  private git(root: string, args: string[], input?: string) { return this.run('git', ['-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', ...args], root, input, this.controller?.signal); }
  private async remoteHead(root: string, url: string, branch: string) {
    const result = (await this.git(root, ['ls-remote', '--heads', url, `refs/heads/${branch}`])).trim();
    if (!result) return '';
    const [oid, ref] = result.split(/\s+/);
    if (!/^[a-f0-9]{40,64}$/.test(oid) || ref !== `refs/heads/${branch}`) throw new Error('원격 브랜치 응답을 확인할 수 없습니다.');
    return oid;
  }
  private async github(root: string): Promise<string | null> {
    try {
      // gh can fall back to plaintext storage. Refuse that configuration without printing its content.
      const config = join(process.env.APPDATA || join(process.env.USERPROFILE || '', '.config'), 'GitHub CLI', 'hosts.yml');
      const fallback = join(process.env.USERPROFILE || '', '.config', 'gh', 'hosts.yml');
      for (const file of [config, fallback]) {
        const content = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
        if (/oauth_token\s*:\s*\S+/.test(content)) return null;
      }
      const login = (await this.run('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], root, undefined, this.controller?.signal)).trim();
      return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(login) ? login : null;
    } catch { return null; }
  }
  private async view(root: string): Promise<GitView> {
    const status = await this.git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const parts = status.split('\0'); const changes: GitView['changes'] = [];
    for (let n = 0; n < parts.length && parts[n]; n++) {
      const row = parts[n]; const path = row.slice(3);
      let blocked = blockedGitPath(path); try { gitPath(path); } catch { blocked = true; }
      // Rename pairs are displayed but require manual resolution; do not silently stage their old path.
      if (/[RC]/.test(row.slice(0, 2))) { n++; blocked = true; }
      let unstageAllowed = row[0] !== ' ' && row[0] !== '?' && !/[RC]/.test(row.slice(0, 2));
      try { gitIndexPath(path); } catch { unstageAllowed = false; }
      changes.push({ path, index: row[0], worktree: row[1], blocked, unstageAllowed });
    }
    const branch = (await this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
    const head = (await this.git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim();
    const rawRemote = (await this.git(root, ['config', '--get', 'remote.origin.url']).catch(() => '')).trim();
    const remote = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(rawRemote) ? rawRemote : null;
    return { root, branch, head, remote, branches: (await this.git(root, ['branch', '--format=%(refname:short)'])).trim().split('\n').filter(Boolean), changes, conflicts: changes.some(c => c.index === 'U' || c.worktree === 'U' || ['AA', 'DD'].includes(c.index + c.worktree)), github: await this.github(root) };
  }
  private async snapshot(root: string, intent: GitIntent, view: GitView) {
    const diff = await this.git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']).catch(async () => this.git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary', '--']));
    const index = await this.git(root, ['ls-files', '--stage', '-z']);
    const config = await this.git(root, ['config', '--null', '--list']);
    const files = [];
    for (const path of intent.files) {
      const c = view.changes.find(c => c.path === path);
      if (intent.operation === 'unstage') {
        gitIndexPath(path); if (!c?.unstageAllowed) throw new Error('스테이징한 파일을 선택하세요.');
        continue; // Never read protected worktree content to remove it from the index.
      }
      if (!c || c.blocked) throw new Error('선택 파일이 변경되었거나 차단되었습니다.');
      if (c.worktree !== 'D' && c.index !== 'D') files.push(await this.workspace.read(this.workspace.info!.id, path));
    }
    return hash({ view, diff, index, config, files });
  }
  private async inspectIndex(root: string) {
    const entries = (await this.git(root, ['ls-files', '--stage', '-z'])).split('\0').filter(Boolean);
    if (entries.some(e => !e.startsWith('100644 ') && !e.startsWith('100755 '))) throw new Error('링크·submodule·미해결 충돌의 커밋은 지원하지 않습니다.');
    const names = (await this.git(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])).split('\0').filter(Boolean);
    if (!names.length) throw new Error('스테이징한 변경이 없습니다.');
    for (const path of names) {
      gitPath(path);
      const content = await this.git(root, ['show', `:${path}`]);
      if (content.includes('\0') || Buffer.byteLength(content) > 2 * 1024 * 1024 || containsSecret(content)) throw new Error('스테이징 내용에 비밀정보·바이너리·크기 제한이 있습니다. 해제 후 확인하세요.');
    }
  }
  private async inspectHistory(root: string) {
    // Inspect every reachable blob, including deleted secrets. Fail closed at bounds.
    const objects = (await this.git(root, ['rev-list', '--objects', 'HEAD'])).trim().split('\n');
    if (objects.length > 1000) throw new Error('이력 검사 한도(1000 객체) 초과. 별도 보안 검토가 필요합니다.');
    let bytes = 0;
    for (const row of objects) {
      const space = row.indexOf(' '); if (space < 0) continue;
      const oid = row.slice(0, space); const path = row.slice(space + 1);
      if (blockedGitPath(path)) throw new Error('이력에 환경·인증·빌드 파일이 있습니다. 별도 보안 검토가 필요합니다.');
      if ((await this.git(root, ['cat-file', '-t', oid])).trim() !== 'blob') continue;
      const size = Number(await this.git(root, ['cat-file', '-s', oid])); bytes += size;
      if (size > 2 * 1024 * 1024 || bytes > 10 * 1024 * 1024) throw new Error('이력 내용 검사 한도 초과');
      const content = await this.git(root, ['cat-file', 'blob', oid]);
      if (content.includes('\0') || containsSecret(content)) throw new Error('이력에 비밀정보 또는 검사할 수 없는 바이너리가 있습니다.');
    }
  }
  execute(request: GitRequest, guard: () => Promise<void>, record: (operation: GitIntent['operation'], outcome: 'started' | 'succeeded' | 'failed') => Promise<void>): Promise<GitResult> {
    const generation = this.session(); const epoch = this.epoch;
    const task = this.queue.catch(() => {}).then(async () => {
      if (epoch !== this.epoch) throw new Error('만료된 작업');
      this.controller = new AbortController();
      const check = async () => { await guard(); if (generation !== this.session() || epoch !== this.epoch) throw new Error('사용자 세션 또는 작업공간이 변경되었습니다.'); this.workspace.assertCurrent(request.id); };
      await check(); const root = await this.root(request.id); const view = await this.view(root); await check();
      if (request.action === 'status') return view;
      if (request.action === 'diff') {
        const change = view.changes.find(c => c.path === request.path); if (!change || change.blocked) throw new Error('파일이 없거나 차단되었습니다.');
        let diff: string;
        if (change.index === '?') diff = (await this.workspace.read(request.id, request.path)).text;
        else diff = await this.git(root, ['diff', '--no-ext-diff', '--no-textconv', '--', request.path]) + await this.git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', request.path]);
        await check(); return { diff: safeDiff(diff) };
      }
      if (request.action === 'prepare') {
        this.pending = undefined; const intent = structuredClone(request.intent);
        let remoteHead: string | undefined; let remoteBase: string | undefined; let remoteDiff = ''; let remoteCommits = '';
        if (this.workspace.dirty) throw new Error('편집 내용을 저장한 후 진행하세요.');
        if (!view.branch || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(view.branch) || view.branch.includes('..')) throw new Error('일반 브랜치에서 실행하세요.');
        if (view.conflicts && intent.operation !== 'unstage' && intent.operation !== 'stage') throw new Error('미해결 충돌이 있습니다. 편집 후 선택 파일을 스테이징하세요.');
        if (intent.operation === 'stage') for (const path of intent.files) {
          const c = view.changes.find(c => c.path === path);
          if (c?.worktree !== 'D' && containsSecret((await this.workspace.read(request.id, path)).text)) throw new Error('선택 파일에 비밀정보가 의심됩니다.');
        }
        if (intent.operation === 'commit') await this.inspectIndex(root);
        if (['push', 'pull', 'pr'].includes(intent.operation)) {
          if (!view.remote || !view.github) throw new Error('HTTPS origin과 안전하게 로그인한 GitHub CLI가 필요합니다.');
          const config = await this.git(root, ['config', '--list']);
          if (/^url\..*\.(?:insteadof|pushinsteadof)=/im.test(config)) throw new Error('URL 재작성 설정이 있는 저장소는 지원하지 않습니다.');
          if (intent.operation === 'pull' && view.changes.length) throw new Error('pull 전에 변경을 커밋하거나 직접 보관하세요. 자동 stash는 하지 않습니다.');
          if (intent.operation !== 'pull') await this.inspectHistory(root);
          remoteHead = await this.remoteHead(root, view.remote, view.branch);
          if (intent.operation === 'pr' && remoteHead !== view.head) throw new Error('현재 브랜치를 먼저 push하세요.');
          const targetBranch = intent.operation === 'pr' ? intent.base : view.branch;
          const target = intent.operation === 'pr' ? await this.remoteHead(root, view.remote, targetBranch) : remoteHead;
          if (intent.operation === 'pr') remoteBase = target;
          if (target) {
            // Fetch only objects/FETCH_HEAD for review; no worktree, index, branch or auto-stash changes.
            await this.git(root, ['fetch', '--no-tags', '--no-recurse-submodules', view.remote, `refs/heads/${targetBranch}`]);
            if ((await this.git(root, ['rev-parse', 'FETCH_HEAD'])).trim() !== target) throw new Error('원격이 변경되었습니다. 다시 검토하세요.');
          } else if (intent.operation !== 'push') throw new Error('대상 원격 브랜치가 없습니다.');
          const empty = target || (await this.git(root, ['hash-object', '-w', '-t', 'tree', '--stdin'], '')).trim();
          remoteDiff = intent.operation === 'pull' ? await this.git(root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', target!, '--']) : await this.git(root, ['diff', '--no-ext-diff', '--no-textconv', empty, 'HEAD', '--']);
          remoteCommits = intent.operation === 'pull' ? await this.git(root, ['log', '--format=%h %s', `HEAD..${target}`]) : await this.git(root, ['log', '--format=%h %s', ...(target ? [`${target}..HEAD`] : ['HEAD'])]);
          remoteCommits = `원격 ${targetBranch}: ${target || '새 브랜치'}\n${remoteCommits}`;
        }
        const snapshot = await this.snapshot(root, intent, view);
        const diff = intent.operation === 'commit' ? await this.git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv']) : (await Promise.all(intent.files.map(async path => {
          const change = view.changes.find(c => c.path === path);
          if (intent.operation === 'unstage' && change?.blocked) return `${path}: 보호 파일의 스테이징만 해제합니다. 내용은 표시하지 않습니다.`;
          return change?.index === '?' ? (await this.workspace.read(request.id, path)).text : this.git(root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', path]).catch(() => this.git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', path]));
        }))).join('\n');
        const commits = view.head ? await this.git(root, ['log', '-10', '--format=%h %s']) : '';
        const approval: GitApproval = { token: randomUUID(), digest: hash({ snapshot, intent, remoteHead }), expires: Date.now() + 120_000, intent, view, diff: safeDiff(remoteDiff || diff), commits: safeDiff(remoteCommits || commits) };
        await check(); this.pending = { id: request.id, session: generation, snapshot, approval, remoteHead, remoteBase }; return structuredClone(approval);
      }
      const pending = this.pending; this.pending = undefined;
      assertApproval(pending ? { id: pending.approval.token, digest: pending.approval.digest, expires: pending.approval.expires } : undefined, request.token, request.digest);
      if (!pending || pending.id !== request.id || pending.session !== generation) throw new Error('만료·중복·변경된 승인입니다.');
      if (!request.accept) return { message: '거절했습니다.' };
      const { intent } = pending.approval;
      if (this.workspace.dirty || pending.snapshot !== await this.snapshot(root, intent, view)) throw new Error('저장소·파일·인증 상태가 변경되었습니다. 다시 검토하세요.');
      if (pending.remoteHead !== undefined && pending.remoteHead !== await this.remoteHead(root, view.remote!, view.branch)) throw new Error('원격 브랜치가 변경되었습니다. 다시 검토하세요.');
      if (pending.remoteBase !== undefined && pending.remoteBase !== await this.remoteHead(root, view.remote!, intent.base)) throw new Error('PR 대상 브랜치가 변경되었습니다. 다시 검토하세요.');
      await record(intent.operation, 'started'); await check();
      if (pending.approval.expires <= Date.now()) throw new Error('승인이 만료되었습니다. 다시 검토하세요.');
      try {
        let url: string | undefined;
        switch (intent.operation) {
          case 'stage': await this.git(root, ['add', '--', ...intent.files]); break;
          case 'unstage':
            if (view.head) await this.git(root, ['restore', '--staged', '--', ...intent.files]);
            else await this.git(root, ['rm', '--cached', '--', ...intent.files]);
            break;
          case 'commit': await this.inspectIndex(root); await check(); await this.git(root, ['commit', '-m', intent.message]); break;
          case 'push': await this.inspectHistory(root); await check(); await this.git(root, ['-c', 'push.followTags=false', '-c', 'remote.origin.mirror=false', 'push', '--porcelain', '--recurse-submodules=no', view.remote!, `HEAD:refs/heads/${view.branch}`]); break;
          case 'pull':
            await this.git(root, ['fetch', '--no-tags', '--no-recurse-submodules', view.remote!, `refs/heads/${view.branch}`]); await check();
            if ((await this.git(root, ['rev-parse', 'FETCH_HEAD'])).trim() !== pending.remoteHead) throw new Error('원격이 변경되었습니다. merge 전에 다시 검토하세요.');
            if ((await this.git(root, ['status', '--porcelain'])).trim()) throw new Error('fetch 중 파일이 변경되었습니다. pull을 중단했습니다.');
            await this.git(root, ['merge', '--ff-only', 'FETCH_HEAD']); break;
          case 'pr': {
            const remoteHead = await this.remoteHead(root, view.remote!, view.branch);
            if (remoteHead !== view.head) throw new Error('현재 브랜치를 먼저 push하고 다시 PR을 검토하세요.');
            await check();
            const output = await this.run('gh', ['pr', 'create', '--repo', view.remote!, '--head', view.branch, '--base', intent.base, '--title', intent.title, '--body-file', '-', '--draft'], root, intent.body, this.controller?.signal);
            const candidate = output.trim();
            if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(candidate) || !candidate.toLowerCase().startsWith(view.remote!.replace(/\.git$/i, '').toLowerCase() + '/pull/')) throw new Error('PR 결과를 확인할 수 없습니다. GitHub에서 중복 생성 여부를 확인하세요.');
            url = candidate; break;
          }
        }
        // An audit outage after mutation must never imply the mutation was rolled back.
        try { await record(intent.operation, 'succeeded'); } catch { return { message: '실행 완료. 작업 기록 저장 실패. 새로고침으로 실제 결과를 확인하세요.', url }; }
        await check(); return { message: '실행 완료. 저장소 상태를 새로고침하세요.', url };
      } catch (error) { await record(intent.operation, 'failed').catch(() => {}); throw error; }
    });
    this.queue = task; return task;
  }
}
