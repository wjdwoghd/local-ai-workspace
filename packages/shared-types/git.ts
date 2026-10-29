import { relativeWorkspacePath } from './workspace';
import type { GitAction } from './collaboration';
export interface GitChange { path: string; index: string; worktree: string; blocked: boolean; unstageAllowed: boolean }
export interface GitView { root: string; branch: string; branches: string[]; head: string; changes: GitChange[]; remote: string | null; conflicts: boolean; github: string | null }
export interface GitIntent { operation: GitAction; files: string[]; message: string; base: string; title: string; body: string }
export interface GitApproval { token: string; digest: string; expires: number; intent: GitIntent; view: GitView; diff: string; commits: string }
export type GitRequest = { action: 'status'; id: string } | { action: 'diff'; id: string; path: string } | { action: 'prepare'; id: string; intent: GitIntent } | { action: 'decide'; id: string; token: string; digest: string; accept: boolean };
export type GitResult = GitView | GitApproval | { message: string; url?: string } | { diff: string };
export function blockedGitPath(path: string) {
  return path.split('/').some(p => p.toLowerCase() !== '.env.example' && /^(?:\.env(?:\..*)?|\.git|\.aws|\.ssh|\.npmrc|\.netrc|credentials(?:\..*)?|secrets?(?:\..*)?|node_modules|dist|build|release|coverage|\.tools|\.next)$/i.test(p)) || /\.(?:pem|key|p12|pfx|exe|dll|msi|log|zip|7z|db|sqlite)$/i.test(path);
}
export function containsSecret(text: string) {
  return /-----BEGIN (?:[A-Z ]*PRIVATE KEY)|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b|(?:api[_-]?key|password|secret|access[_-]?token)\s*[=:]\s*["']?(?!["']?(?:$|\s|test|example|placeholder|process\.env|\$\{))[A-Za-z0-9_+\/-]{12,}/im.test(text);
}
export function gitPath(value: unknown): asserts value is string { relativeWorkspacePath(value); if ((value as string).startsWith('-') || blockedGitPath(value as string)) throw new Error('환경·인증·빌드 파일은 Git 작업이 차단됩니다.'); }
export function gitIndexPath(value: unknown): asserts value is string {
  relativeWorkspacePath(value, false, true);
  if (value.startsWith('-') || value.split('/').some(p => p.toLowerCase() === '.git')) throw new Error('잘못된 인덱스 경로');
}
export function parseGitRequest(raw: unknown): GitRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('잘못된 Git 요청');
  const o = raw as Record<string, unknown>;
  const shapes: Record<string, string[]> = { status: ['id'], diff: ['id', 'path'], prepare: ['id', 'intent'], decide: ['id', 'token', 'digest', 'accept'] };
  if (typeof o.action !== 'string' || !Object.hasOwn(shapes, o.action) || Object.keys(o).sort().join() !== ['action', ...shapes[o.action]].sort().join() || typeof o.id !== 'string' || !/^[a-f0-9-]{36}$/.test(o.id)) throw new Error('잘못된 Git 요청');
  if (o.action === 'diff') gitPath(o.path);
  if (o.action === 'decide' && (typeof o.accept !== 'boolean' || typeof o.token !== 'string' || !/^[a-f0-9-]{36}$/.test(o.token) || typeof o.digest !== 'string' || !/^[a-f0-9]{64}$/.test(o.digest))) throw new Error('잘못된 승인');
  if (o.action === 'prepare') {
    const i = o.intent as GitIntent;
    if (!i || Object.keys(i).sort().join() !== 'base,body,files,message,operation,title' || !['stage', 'unstage', 'commit', 'push', 'pull', 'pr'].includes(i.operation) || !Array.isArray(i.files) || i.files.length > 100 || new Set(i.files).size !== i.files.length) throw new Error('잘못된 Git 작업');
    i.files.forEach(i.operation === 'unstage' ? gitIndexPath : gitPath);
    for (const k of ['message', 'base', 'title', 'body'] as const) if (typeof i[k] !== 'string' || i[k].length > (k === 'body' ? 8000 : 500) || i[k].includes('\0') || containsSecret(i[k])) throw new Error('입력 길이 또는 비밀정보를 확인하세요.');
    if (['stage', 'unstage'].includes(i.operation) && !i.files.length || i.operation === 'commit' && !i.message.trim() || i.operation === 'pr' && (!i.title.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(i.base) || i.base.includes('..'))) throw new Error('파일·메시지·대상 브랜치를 선택하세요.');
  }
  return o as unknown as GitRequest;
}
