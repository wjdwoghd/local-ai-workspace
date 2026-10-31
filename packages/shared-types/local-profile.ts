import { username, type Theme } from './auth';
export interface LocalProfile { id: string; name: string }
export interface LocalProfileView { profiles: LocalProfile[]; active: LocalProfile | null; theme: Theme; directory: string | null }
export type LocalProfileRequest = { action: 'list' | 'leave' } | { action: 'create'; name: string } | { action: 'select'; id: string };
export function parseLocalProfileRequest(raw: unknown): LocalProfileRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('잘못된 프로필 요청');
  const r = raw as Record<string, unknown>;
  const shapes: Record<string, string[]> = { list: [], leave: [], create: ['name'], select: ['id'] };
  if (typeof r.action !== 'string' || !Object.hasOwn(shapes, r.action) || Object.keys(r).sort().join() !== ['action', ...shapes[r.action]].sort().join()) throw new Error('잘못된 프로필 요청');
  if (r.action === 'select' && (typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id))) throw new Error('잘못된 프로필 ID');
  if (r.action === 'create') return { action: 'create', name: username(r.name) };
  return r as unknown as LocalProfileRequest;
}
