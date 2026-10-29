export const WORKSPACE_LIMITS = { bytes: 2 * 1024 * 1024, tabs: 20, entries: 5000, watches: 128 } as const;
export const WORKSPACE_HIDDEN = ['.git', 'node_modules', 'dist', 'build', 'release', '.next', 'coverage', '.pnpm-store', '.tools'];
export interface WorkspaceInfo { id: string; name: string; root: string }
export interface WorkspaceEntry { path: string; name: string; directory: boolean; blocked: boolean }
export interface WorkspaceFile { path: string; text: string; version: string; bom: boolean; eol: 'LF' | 'CRLF' | 'CR' | 'mixed' }
export type WorkspaceEvent = { id: string } & (
  { type: 'change'; directory: string } | { type: 'lost'; message: string } |
  { type: 'output'; terminal: string; data: string } | { type: 'exit'; terminal: string; code: number } |
  { type: 'close-request' } | { type: 'reset' });
export type SaveResult = { conflict: false; file: WorkspaceFile } | { conflict: true; disk: WorkspaceFile | null };
export type WorkspaceRequest =
  | { action: 'pick' }
  | { action: 'close' | 'close-window' | 'terminal-start' | 'terminal-stop'; id: string }
  | { action: 'list' | 'read'; id: string; path: string }
  | { action: 'save'; id: string; path: string; text: string; version: string; overwrite: boolean }
  | { action: 'dirty'; id: string; dirty: boolean }
  | { action: 'terminal-write'; id: string; terminal: string; data: string }
  | { action: 'terminal-resize'; id: string; terminal: string; cols: number; rows: number };

export interface WorkspaceAPI {
  pick(): Promise<WorkspaceInfo | null>;
  close(id: string): Promise<void>;
  closeWindow(id: string): Promise<void>;
  list(id: string, path: string): Promise<WorkspaceEntry[]>;
  read(id: string, path: string): Promise<WorkspaceFile>;
  save(id: string, path: string, text: string, version: string, overwrite: boolean): Promise<SaveResult>;
  dirty(id: string, dirty: boolean): Promise<void>;
  terminalStart(id: string): Promise<string>;
  terminalStop(id: string): Promise<void>;
  terminalWrite(id: string, terminal: string, data: string): Promise<void>;
  terminalResize(id: string, terminal: string, cols: number, rows: number): Promise<void>;
  onEvent(callback: (event: WorkspaceEvent) => void): () => void;
}

export function relativeWorkspacePath(value: unknown, allowRoot = false, allowHidden = false): asserts value is string {
  if (typeof value !== 'string' || value.length > 1024 || (!value && !allowRoot) ||
    (value !== '' && value.split('/').some(part => !part || part === '.' || part === '..' ||
      /[\\:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) || (!allowHidden && WORKSPACE_HIDDEN.includes(part.toLowerCase()))))) {
    throw new Error('허용되지 않은 상대 경로입니다.');
  }
}
export function parseWorkspaceRequest(raw: unknown): WorkspaceRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('잘못된 작업공간 요청입니다.');
  const r = raw as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    pick: [], close: ['id'], 'close-window': ['id'], list: ['id', 'path'], read: ['id', 'path'],
    save: ['id', 'path', 'text', 'version', 'overwrite'], dirty: ['id', 'dirty'],
    'terminal-start': ['id'], 'terminal-stop': ['id'], 'terminal-write': ['id', 'terminal', 'data'],
    'terminal-resize': ['id', 'terminal', 'cols', 'rows'],
  };
  if (typeof r.action !== 'string' || !Object.hasOwn(fields, r.action) ||
    Object.keys(r).some(k => k !== 'action' && !fields[r.action as string].includes(k)) ||
    fields[r.action].some(k => !(k in r))) throw new Error('잘못된 작업공간 요청입니다.');
  if (r.action !== 'pick' && (typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id))) throw new Error('잘못된 작업공간 ID입니다.');
  if ('path' in r) relativeWorkspacePath(r.path, r.action === 'list');
  if (r.action === 'dirty' && typeof r.dirty !== 'boolean') throw new Error('잘못된 수정 상태입니다.');
  if (r.action === 'save' && (typeof r.text !== 'string' || r.text.length > WORKSPACE_LIMITS.bytes ||
    typeof r.version !== 'string' || !/^[a-f0-9]{64}$/.test(r.version) || typeof r.overwrite !== 'boolean')) throw new Error('파일 저장 한도를 확인하세요.');
  if ('terminal' in r && (typeof r.terminal !== 'string' || !/^[a-f0-9-]{36}$/.test(r.terminal))) throw new Error('잘못된 터미널 ID입니다.');
  if (r.action === 'terminal-write' && (typeof r.data !== 'string' || r.data.length > 8192)) throw new Error('터미널 입력 한도 초과입니다.');
  if (r.action === 'terminal-resize' && (!Number.isInteger(r.cols) || !Number.isInteger(r.rows) || Number(r.cols) < 2 || Number(r.cols) > 500 || Number(r.rows) < 2 || Number(r.rows) > 200)) throw new Error('잘못된 터미널 크기입니다.');
  return raw as WorkspaceRequest;
}
