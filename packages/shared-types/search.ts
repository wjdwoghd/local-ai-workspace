import { InputError, parseOperation } from './auth';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md'] as const;
export interface DocumentMeta { id: string; name: string; owner: string; teamId: string | null; chunks: number }
export interface Team { id: string; name: string }
export interface SearchHit { documentId: string; name: string; chunk: number; location: string; text: string }
export interface Citation { kind: 'web' | 'document'; title: string; url?: string; start?: number; end?: number; documentId?: string; chunk?: number; location?: string }
export type SearchOperation =
  | { action: 'documents' | 'teams' }
  | { action: 'searchDocuments'; query: string }
  | { action: 'deleteDocument' | 'readDocument'; id: string }
  | { action: 'createTeam'; name: string }
  | { action: 'addTeamMember' | 'removeTeamMember'; id: string; userId: string };
export function parseSearchOperation(o: Record<string, unknown>): SearchOperation | undefined {
  const shapes: Record<string, string[]> = { documents: [], teams: [], searchDocuments: ['query'], deleteDocument: ['id'], readDocument: ['id'], createTeam: ['name'], addTeamMember: ['id', 'userId'], removeTeamMember: ['id', 'userId'] };
  if (typeof o.action !== 'string' || !Object.hasOwn(shapes, o.action)) return;
  const keys = shapes[o.action];
  if (Object.keys(o).some(k => k !== 'action' && !keys.includes(k)) || keys.some(k => !(k in o))) throw new InputError('잘못된 검색 요청입니다.');
  for (const key of ['id', 'userId']) if (keys.includes(key)) parseOperation({ action: 'getConversation', id: o[key] });
  if (keys.includes('query') && (typeof o.query !== 'string' || !o.query.trim() || o.query.length > 200)) throw new InputError('검색어는 1~200자입니다.');
  if (keys.includes('name') && (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 100)) throw new InputError('팀 이름은 1~100자입니다.');
  return o as unknown as SearchOperation;
}
export interface UploadInput { name: string; base64: string; teamId: string | null }
export function parseUpload(raw: unknown): UploadInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('잘못된 문서입니다.');
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'base64,name,teamId' || typeof o.name !== 'string' || o.name.length > 200 || /[\\/\x00-\x1f]/.test(o.name) || !FILE_EXTENSIONS.includes(o.name.split('.').pop()?.toLowerCase() as typeof FILE_EXTENSIONS[number])) throw new InputError('지원하는 문서 파일을 선택하세요.');
  if (o.teamId !== null) parseOperation({ action: 'getConversation', id: o.teamId });
  if (typeof o.base64 !== 'string' || !o.base64.length || o.base64.length % 4 !== 0 || o.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(o.base64)) throw new InputError('문서는 최대 10MB입니다.');
  return o as unknown as UploadInput;
}
export function safeWebURL(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try { const u = new URL(raw); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
