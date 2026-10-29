import { parseSearchOperation, type SearchOperation } from './search';
import { parseCollaboration, type CollaborationOperation } from './collaboration';
export type Role = "admin" | "user";
export type Theme = "light" | "dark" | "system";
export interface User { id: string; username: string; role: Role; active: boolean }
export interface ConversationMeta { id: string; title: string }
export interface Settings { theme: Theme }
export type Operation =
  | SearchOperation
  | CollaborationOperation
  | { action: "login"; username: string; password: string }
  | { action: "logout" | "me" | "users" | "conversations" | "settings" | "chatStatus" }
  | { action: "createUser"; username: string; password: string; role: Role }
  | { action: "disableUser"; id: string }
  | { action: "resetPassword"; id: string; password: string }
  | { action: "saveSettings"; theme: Theme }
  | { action: "resetSettings" }
  | { action: "createConversation"; title: string }
  | { action: "getConversation" | "deleteConversation" | "messages"; id: string }
  | { action: "updateConversation"; id: string; title: string };
export type Result<T = unknown> = { ok: true; data: T } | { ok: false; status: number; message: string };
export class InputError extends Error {}
export function username(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) throw new InputError("계정 이름은 영문·숫자·._- 3~64자입니다.");
  return value.toLowerCase();
}
export function password(value: unknown, creating = true): string {
  if (typeof value !== "string" || value.length < (creating ? 12 : 1) || value.length > 128) throw new InputError("비밀번호 길이를 확인하세요(신규 12~128자).");
  return value;
}
export function parseOperation(raw: unknown): Operation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError("잘못된 요청입니다.");
  const o = raw as Record<string, unknown>;
  const collaboration = parseCollaboration(o);
  if (collaboration) return collaboration;
  const search = parseSearchOperation(o);
  if (search) return search;
  const shape: Record<string, string[]> = {
    login: ["username", "password"], logout: [], me: [], users: [], conversations: [], settings: [], chatStatus: [], messages: ["id"],
    createUser: ["username", "password", "role"], disableUser: ["id"], resetPassword: ["id", "password"],
    saveSettings: ["theme"], resetSettings: [], createConversation: ["title"], getConversation: ["id"],
    deleteConversation: ["id"], updateConversation: ["id", "title"],
  };
  if (typeof o.action !== "string" || !Object.hasOwn(shape, o.action)) throw new InputError("허용되지 않은 작업입니다.");
  const keys = shape[o.action];
  if (Object.keys(o).some(k => k !== "action" && !keys.includes(k)) || keys.some(k => !(k in o))) throw new InputError("잘못된 요청 필드입니다.");
  const result = { ...o };
  if (keys.includes("username")) result.username = username(o.username);
  if (keys.includes("password")) result.password = password(o.password, o.action !== "login");
  if (keys.includes("id") && (typeof o.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(o.id))) throw new InputError("잘못된 리소스 ID입니다.");
  if (keys.includes("title") && (typeof o.title !== "string" || !o.title.trim() || o.title.length > 200)) throw new InputError("제목은 1~200자입니다.");
  if (keys.includes("role") && o.role !== "admin" && o.role !== "user") throw new InputError("잘못된 역할입니다.");
  if (keys.includes("theme") && !["light", "dark", "system"].includes(o.theme as string)) throw new InputError("잘못된 테마입니다.");
  return result as Operation;
}
