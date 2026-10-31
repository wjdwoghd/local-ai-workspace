import { agentPath } from './agent';
import { parseReasoning,type ReasoningEffort } from './reasoning';
export interface TaskInput { prompt: string; model: string;reasoningEffort?:ReasoningEffort; files: string[]; history?: {role:'user'|'assistant';text:string}[] }
export interface TaskPlan { kind: 'chat' | 'files' | 'code'; query: string; mode: 'ask' | 'edit'; paths: string[] }
export function parseTaskInput(raw: unknown): TaskInput {
  const r = raw as TaskInput;
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k=>!['files','model','prompt','history','reasoningEffort'].includes(k)) || typeof r.prompt !== 'string' || !r.prompt.trim() || r.prompt.length > 4000 || typeof r.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(r.model) || !Array.isArray(r.files) || r.files.length > 400 || new Set(r.files).size !== r.files.length) throw new Error('잘못된 작업 요청');
  if('reasoningEffort'in r)parseReasoning(r.reasoningEffort);
  if(r.history!==undefined&&(!Array.isArray(r.history)||r.history.length>6||r.history.some(m=>!m||Object.keys(m).sort().join(',')!=='role,text'||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>2000)))throw new Error('작업 대화 문맥 한도');
  r.files.forEach(agentPath); return r;
}
export function parseTaskPlan(raw: unknown, input: TaskInput): TaskPlan {
  const r = raw as TaskPlan;
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'kind,mode,paths,query' || !['chat','files','code'].includes(r.kind) || !['ask','edit'].includes(r.mode) || typeof r.query !== 'string' || r.query.length > 200 || !Array.isArray(r.paths) || r.paths.length > 20 || new Set(r.paths).size !== r.paths.length || r.paths.some(p => !input.files.includes(p)) || (r.kind === 'files' && !r.query.trim())) throw new Error('AI 작업 계획의 범위를 확인하지 못했습니다.');
  return r;
}
