import { AGENT_LIMITS, agentPath, type AgentMode } from './agent';
export interface CodeFile { path: string; text: string; version: string }
export interface CodeInput { mode: AgentMode; prompt: string; files: CodeFile[] }
export interface CodeOutput { summary: string; changes: { path: string; after: string }[] }
export function parseCodeInput(raw: unknown): CodeInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('잘못된 코딩 요청');
  const r=raw as CodeInput;
  if (Object.keys(r).sort().join(',')!=='files,mode,prompt' || !['ask','edit','agent'].includes(r.mode) || typeof r.prompt!=='string' || !r.prompt.trim() || r.prompt.length>4000 || !Array.isArray(r.files) || !r.files.length || r.files.length>AGENT_LIMITS.files) throw new Error('코딩 요청 범위 오류');
  let size=0;const seen=new Set<string>();
  for(const f of r.files){if(!f||Object.keys(f).sort().join(',')!=='path,text,version')throw new Error('파일 범위 오류');agentPath(f.path);if(typeof f.text!=='string'||typeof f.version!=='string'||!/^[a-f0-9]{64}$/.test(f.version))throw new Error('파일 형식 오류');size+=new TextEncoder().encode(f.text).length;if(new TextEncoder().encode(f.text).length>AGENT_LIMITS.bytes||seen.has(f.path.toLowerCase()))throw new Error('파일 한도 오류');seen.add(f.path.toLowerCase());}
  if(size>AGENT_LIMITS.total)throw new Error('파일 합계 한도 오류');return r;
}
export function parseCodeOutput(raw: unknown, input: CodeInput): CodeOutput {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('코딩 응답 형식 오류');const r=raw as CodeOutput;
  if(Object.keys(r).sort().join(',')!=='changes,summary'||typeof r.summary!=='string'||r.summary.length>32000||!Array.isArray(r.changes)||r.changes.length>AGENT_LIMITS.files||(input.mode==='ask'&&r.changes.length))throw new Error('코딩 응답 범위 오류');
  let total=0;const seen=new Set<string>();for(const c of r.changes){if(!c||Object.keys(c).sort().join(',')!=='after,path'||typeof c.after!=='string'||!input.files.some(f=>f.path===c.path)||seen.has(c.path))throw new Error('선택하지 않은 파일 제안');agentPath(c.path);const n=new TextEncoder().encode(c.after).length;total+=n;if(n>AGENT_LIMITS.bytes||total>AGENT_LIMITS.total)throw new Error('제안 한도 오류');seen.add(c.path);}return r;
}
