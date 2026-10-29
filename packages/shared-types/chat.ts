import { InputError, parseOperation } from './auth';
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; model: string }
export interface ChatModel { id: string; label: string }
export interface ChatStatus { configured: boolean; message: string; models: ChatModel[] }
export interface ChatInput { id: string; text: string; model: string }
export type ChatEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; status: number; message: string };
export function parseChat(raw: unknown): ChatInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('잘못된 채팅 요청입니다.');
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'id,model,text') throw new InputError('잘못된 채팅 필드입니다.');
  parseOperation({ action: 'getConversation', id: o.id });
  if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > 4000) throw new InputError('메시지는 1~4000자입니다.');
  if (typeof o.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(o.model)) throw new InputError('잘못된 모델입니다.');
  return { id: o.id as string, text: o.text.trim(), model: o.model };
}
