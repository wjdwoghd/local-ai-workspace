import { relativeWorkspacePath } from './workspace';
import { parseReasoning,type ReasoningEffort } from './reasoning';
export type AgentMode = 'ask' | 'edit' | 'agent';
export type AgentState = 'ready' | 'analyzing' | 'approval' | 'running' | 'completed' | 'failed' | 'interrupted' | 'setup-required';
export interface AgentScope { session: number; workspace: string; thread: string; turn: string }
export interface AgentChange { path: string; before: string; after: string; version: string }
export interface AgentApproval { id: string; scope: AgentScope; changes: AgentChange[]; expires: number; digest: string }
export interface AgentView {
  state: AgentState; mode: AgentMode; source: 'local' | 'api'; model: string | null; authentication: 'unconfigured' | 'server';
  message: string; files: { path: string; bytes: number; version: string }[];
  approval?: AgentApproval; applied: string[]; unapplied: string[];
}
export type AgentRequest = { action: 'status' | 'stop' | 'start'; id: string; mode: AgentMode } |
  { action: 'analyze'; id: string; mode: AgentMode; paths: string[] } |
  { action: 'generate'; id: string; mode: AgentMode; paths: string[]; prompt: string; model?: string;reasoningEffort?:ReasoningEffort } |
  { action: 'decide'; id: string; mode: AgentMode; approval: string; digest: string; accept: boolean };
export interface AgentAPI { execute(request: AgentRequest): Promise<AgentView> }
export const AGENT_LIMITS = { files: 20, bytes: 256 * 1024, total: 1024 * 1024, milliseconds: 10000, approvalMs: 120000 };
export function agentPath(path: unknown): asserts path is string {
  relativeWorkspacePath(path);
  if (path.split('/').some(p => p.startsWith('.') || /(?:secret|credential|token|password)/i.test(p) || /\.(?:pem|key|pfx|p12|crt|cer|der|jks|keystore|env)$/i.test(p))) throw new Error('에이전트 분석에서 제외된 파일입니다.');
}
export function parseAgentRequest(raw: unknown): AgentRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('잘못된 에이전트 요청');
  const r = raw as Record<string, unknown>;
  const fields: Record<string, string[]> = { status: [], stop: [], start: [], analyze: ['paths'], generate:['paths','prompt'], decide: ['approval', 'digest', 'accept'] };
  if (typeof r.action !== 'string' || !Object.hasOwn(fields, r.action) || !['ask', 'edit', 'agent'].includes(r.mode as string) || typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id) || Object.keys(r).some(k => !(r.action === 'generate' && ['model','reasoningEffort'].includes(k)) && !['action', 'id', 'mode', ...fields[r.action as string]].includes(k)) || fields[r.action].some(k => !(k in r))) throw new Error('잘못된 에이전트 요청');
  if('reasoningEffort'in r)parseReasoning(r.reasoningEffort);
  if ('model' in r && (typeof r.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(r.model))) throw new Error('잘못된 모델');
  if (r.action === 'generate' && (typeof r.prompt!=='string'||!r.prompt.trim()||r.prompt.length>4000))throw new Error('코딩 요청은 1~4000자입니다.');
  if (r.action === 'analyze' || r.action === 'generate') {
    if (!Array.isArray(r.paths) || !r.paths.length || r.paths.length > AGENT_LIMITS.files || new Set(r.paths).size !== r.paths.length) throw new Error('파일은 1~20개를 선택하세요.');
    r.paths.forEach(agentPath);
  }
  if (r.action === 'decide' && (typeof r.approval !== 'string' || r.approval.length > 80 || typeof r.digest !== 'string' || !/^[a-f0-9]{64}$/.test(r.digest) || typeof r.accept !== 'boolean')) throw new Error('잘못된 승인 응답');
  return r as unknown as AgentRequest;
}
