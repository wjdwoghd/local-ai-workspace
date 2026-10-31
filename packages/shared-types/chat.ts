import { InputError, parseOperation } from './auth';
import type { Citation } from './search';
import { agentPath } from './agent';
import { parseAttachments, type ChatAttachment } from './attachments';
import { parseReasoning,type ReasoningEffort } from './reasoning';
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; model: string; citations?: Citation[]; attachments?:ChatAttachment[] }
export interface ChatModel { id: string; label: string;reasoningEfforts?:ReasoningEffort[] }
export interface ChatStatus { configured: boolean; message: string; models: ChatModel[] }
export interface ChatInput { id: string; text: string; model: string;reasoningEffort?:ReasoningEffort; webSearch?: boolean; documentSearch?: boolean; autoTools?: boolean; projectContext?: {path:string;text:string}[]; attachments?:ChatAttachment[] }
export type ChatEvent = { type: 'delta'; text: string } | { type: 'sources'; citations: Citation[] } | { type: 'done' } | { type: 'error'; status: number; message: string };
export function parseChat(raw: unknown): ChatInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('잘못된 채팅 요청입니다.');
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some(k => !['id', 'model', 'text', 'webSearch', 'documentSearch', 'autoTools', 'projectContext', 'attachments','reasoningEffort'].includes(k))) throw new InputError('잘못된 채팅 필드입니다.');
  let effort:ReasoningEffort|undefined;if('reasoningEffort'in o){try{effort=parseReasoning(o.reasoningEffort);}catch{throw new InputError('지원하지 않는 추론 수준입니다.');}}
  let attachments:ChatAttachment[]|undefined;
  if('attachments'in o){try{attachments=parseAttachments(o.attachments);}catch(e){throw new InputError((e as Error).message);}}
  for (const key of ['webSearch', 'documentSearch', 'autoTools']) if (key in o && typeof o[key] !== 'boolean') throw new InputError('잘못된 검색 옵션입니다.');
  if ('projectContext' in o) {
    if(!Array.isArray(o.projectContext)||o.projectContext.length>20)throw new InputError('프로젝트 문맥 한도');
    for(const f of o.projectContext){if(!f||typeof f!=='object'||Object.keys(f).sort().join(',')!=='path,text'||typeof f.text!=='string'||f.text.length>2000)throw new InputError('프로젝트 문맥 오류');try{agentPath(f.path);}catch{throw new InputError('프로젝트 문맥 경로 오류');}}
  }
  parseOperation({ action: 'getConversation', id: o.id });
  if (typeof o.text !== 'string' || (!o.text.trim()&&!attachments?.length) || o.text.length > 4000) throw new InputError('메시지를 입력하거나 파일을 첨부하세요. 최대 4000자입니다.');
  if (typeof o.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(o.model)) throw new InputError('잘못된 모델입니다.');
  return { id: o.id as string, text: o.text.trim(), model: o.model,...(effort?{reasoningEffort:effort}:{}), ...(attachments?.length ? {attachments} : {}), ...(o.webSearch !== undefined ? { webSearch: o.webSearch as boolean } : {}), ...(o.documentSearch !== undefined ? { documentSearch: o.documentSearch as boolean } : {}), ...(o.autoTools !== undefined ? { autoTools: o.autoTools as boolean } : {}), ...(o.projectContext !== undefined ? {projectContext:o.projectContext as ChatInput['projectContext']} : {}) };
}
