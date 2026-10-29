import { parseOperation, type Operation, type Result } from "../../../../packages/shared-types/auth";
import { parseChat, type ChatEvent } from '../../../../packages/shared-types/chat';
import { sse } from '../../../../packages/shared-types/sse';
import { parseUpload, type UploadInput } from '../../../../packages/shared-types/search';

export function serverURL(value: string | undefined, packaged: boolean) {
  const url = new URL(value || "http://127.0.0.1:3001");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && (packaged || url.protocol !== "http:" || url.hostname !== "127.0.0.1"))) {
    throw new Error("서버 주소는 HTTPS여야 합니다. 개발 환경만 루프백 HTTP를 허용합니다.");
  }
  return new URL("/api/action", url).href;
}
export class AuthClient {
  private token: string | undefined;
  sessionGeneration = 0;
  get hasSession() { return !!this.token; }
  private get credential() { return this.token; }
  private set credential(value: string | undefined) {
    if (value !== this.token) { this.token = value; this.sessionGeneration++; this.onSessionChange(); }
  }
  private queue = Promise.resolve();
  private streamController?: AbortController;
  constructor(private url: string, private transport: typeof fetch = fetch, private onSessionChange: () => void = () => {}) {}
  execute(raw: unknown): Promise<Result> {
    let op: Operation;
    try { op = parseOperation(raw); }
    catch { return Promise.resolve({ ok: false, status: 400, message: "잘못된 요청입니다." }); }
    if (op.action === 'login' || op.action === 'logout') this.cancelChat();
    let result!: Result;
    const task = this.queue.then(async () => { result = await this.perform(op); });
    this.queue = task.catch(() => {});
    return task.then(() => result);
  }
  cancelChat() { this.streamController?.abort(); }
  importDocument(pick: () => Promise<UploadInput | undefined>): Promise<Result> {
    let result!: Result;
    const task = this.queue.then(async () => {
      if (!this.credential) { result = { ok: false, status: 401, message: '로그인이 필요합니다.' }; return; }
      try {
        const input = await pick();
        if (!input) { result = { ok: true, data: null }; return; }
        parseUpload(input);
        const response = await this.transport(new URL('/api/documents', this.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.credential}` },
          body: JSON.stringify(input), signal: AbortSignal.timeout(60_000), redirect: 'error', cache: 'no-store' });
        if (response.status === 401) this.credential = undefined;
        if (!response.ok) { result = { ok: false, status: response.status, message: response.status === 401 ? '세션이 만료되었습니다.' : response.status === 403 ? '팀 문서 권한이 없습니다.' : response.status === 429 ? '문서를 처리 중입니다. 잠시 후 다시 시도하세요.' : '문서 등록에 실패했습니다. 형식·암호·텍스트·크기(최대 10MB)를 확인하세요.' }; return; }
        result = await response.json() as Result;
      } catch { result = { ok: false, status: 400, message: '문서를 읽거나 등록하지 못했습니다. 파일 크기와 서버 연결을 확인하세요.' }; }
    });
    this.queue = task.catch(() => {});
    return task.then(() => result);
  }
  async stream(raw: unknown, emit: (event: ChatEvent) => void): Promise<Result> {
    let input;
    try { input = parseChat(raw); } catch { return { ok: false, status: 400, message: '잘못된 채팅 요청입니다.' }; }
    await this.queue;
    if (!this.credential) return { ok: false, status: 401, message: '로그인이 필요합니다.' };
    if (this.streamController) return { ok: false, status: 409, message: '응답 생성이 이미 진행 중입니다.' };
    const credential = this.credential;
    const controller = new AbortController(); this.streamController = controller;
    const timeout = setTimeout(() => controller.abort(), 130_000);
    try {
      const response = await this.transport(new URL('/api/chat', this.url), { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
        body: JSON.stringify(input), signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (!response.ok || !response.body) {
        if (response.status === 401 && this.credential === credential) this.credential = undefined;
        return { ok: false, status: response.status, message: response.status === 401 ? '세션이 만료되었습니다. 다시 로그인하세요.' : response.status === 400 ? '입력·모델 또는 대화 길이 한도를 확인하세요. 대화가 길다면 새 대화를 시작하세요.' : response.status === 409 ? '대화 응답 생성 중입니다. 잠시 후 다시 시도하세요.' : response.status === 429 ? 'AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.' : 'AI 요청에 실패했습니다. 서버의 API 키·모델 권한·연결을 확인하세요.' };
      }
      for await (const rawEvent of sse(response.body)) {
        controller.signal.throwIfAborted();
        if (credential !== this.credential) throw new Error('Session changed');
        const event = rawEvent as ChatEvent;
        if (event.type === 'delta' && typeof event.text === 'string') emit(event);
        else if (event.type === 'sources' && Array.isArray(event.citations) && event.citations.length <= 106) emit(event);
        else if (event.type === 'done') { emit(event); return { ok: true, data: null }; }
        else if (event.type === 'error') {
          if (event.status === 401) this.credential = undefined;
          // Never forward arbitrary upstream error strings to renderer.
          return { ok: false, status: event.status, message: event.status === 401 ? '세션이 만료되었습니다. 다시 로그인하세요.' : '응답이 중단되었거나 저장하지 못했습니다. 대화를 확인하고 다시 시도하세요.' };
        } else throw new Error('Invalid stream');
      }
      throw new Error('Truncated stream');
    } catch { return { ok: false, status: 503, message: '응답이 중단되었습니다. 대화를 다시 불러와 저장 여부를 확인하세요.' }; }
    finally { clearTimeout(timeout); if (this.streamController === controller) this.streamController = undefined; }
  }
  private async request(op: Operation, credential = this.credential): Promise<Result> {
    try {
      const response = await this.transport(this.url, {
        method: "POST", headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
        body: JSON.stringify(op), redirect: "error", signal: AbortSignal.timeout(10000), cache: "no-store",
      });
      const result = await response.json() as Result;
      if (!response.ok) return { ok: false, status: response.status, message: response.status === 401 ? "계정 정보를 확인하거나 다시 로그인하세요." : response.status === 403 ? "권한이 없습니다." : response.status === 429 ? "로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요." : "요청을 처리하지 못했습니다." };
      if (!result.ok) return { ok: false, status: 503, message: "서버 응답을 확인할 수 없습니다." };
      return result;
    } catch { return { ok: false, status: 503, message: "인증 서버에 연결할 수 없습니다. 서버 설정과 연결을 확인하세요." }; }
  }
  private async perform(op: Operation): Promise<Result> {
    if (op.action === "login" || op.action === "logout") {
      this.cancelChat();
      const previous = this.credential;
      this.credential = undefined;
      if (previous) {
        const revoked = await this.request({ action: "logout" }, previous);
        if (!revoked.ok && revoked.status !== 401) return revoked;
      }
      if (op.action === "logout") return { ok: true, data: null };
    } else if (!this.credential) return { ok: false, status: 401, message: "로그인이 필요합니다." };
    const result = await this.request(op);
    if (!result.ok && result.status === 401) { this.credential = undefined; this.cancelChat(); }
    if (op.action === "login" && result.ok) {
      const data = result.data as { credential: string; user: unknown };
      if (typeof data.credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.credential)) return { ok: false, status: 503, message: "잘못된 인증 서버 응답입니다." };
      this.credential = data.credential;
      return { ok: true, data: data.user };
    }
    return result;
  }
}
