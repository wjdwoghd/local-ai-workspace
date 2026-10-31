import { InputError } from './auth';
export type CollaborationOperation =
  | { action: 'activity' }
  | { action: 'myUsage' }
  | { action: 'teamUsage'; id: string }
  | { action: 'shareDocument'; id: string; teamId: string | null }
  | { action: 'recordGit'; operation: GitAction; outcome: 'started' | 'succeeded' | 'failed' };
export type GitAction = 'stage' | 'unstage' | 'commit' | 'push' | 'pull' | 'pr' | 'checkout' | 'create-branch';
export interface TokenUsage { input: number; output: number; total: number }
export interface UsageSummary { records: number; input: number | null; output: number | null; total: number | null; cost: null; scope: string }
export interface Activity { id: string; action: string; outcome: string; time: string }
export function parseCollaboration(o: Record<string, unknown>): CollaborationOperation | undefined {
  const shapes: Record<string, string[]> = { activity: [], myUsage: [], teamUsage: ['id'], shareDocument: ['id', 'teamId'], recordGit: ['operation', 'outcome'] };
  if (typeof o.action !== 'string' || !Object.hasOwn(shapes, o.action)) return;
  const keys = shapes[o.action];
  if (Object.keys(o).some(k => k !== 'action' && !keys.includes(k)) || keys.some(k => !(k in o))) throw new InputError('잘못된 협업 요청');
  for (const k of ['id', 'teamId']) if (keys.includes(k) && !(k === 'teamId' && o[k] === null) && (typeof o[k] !== 'string' || !/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(o[k] as string))) throw new InputError('잘못된 ID');
  if (o.action === 'recordGit' && (!['stage', 'unstage', 'commit', 'push', 'pull', 'pr','checkout','create-branch'].includes(o.operation as string) || !['started', 'succeeded', 'failed'].includes(o.outcome as string))) throw new InputError('잘못된 Git 기록');
  return o as unknown as CollaborationOperation;
}
export function tokenUsage(raw: unknown): TokenUsage | undefined {
  const u = raw as Record<string, unknown> | null;
  if (!u || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => Number.isSafeInteger(u[k]) && (u[k] as number) >= 0) || (u.input_tokens as number) + (u.output_tokens as number) !== u.total_tokens) return;
  return { input: u.input_tokens as number, output: u.output_tokens as number, total: u.total_tokens as number };
}
