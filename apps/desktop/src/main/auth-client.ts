import { parseOperation, type Operation, type Result } from "../../../../packages/shared-types/auth";

export function serverURL(value: string | undefined, packaged: boolean) {
  const url = new URL(value || "http://127.0.0.1:3001");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && (packaged || url.protocol !== "http:" || url.hostname !== "127.0.0.1"))) {
    throw new Error("서버 주소는 HTTPS여야 합니다. 개발 환경만 루프백 HTTP를 허용합니다.");
  }
  return new URL("/api/action", url).href;
}
export class AuthClient {
  private credential: string | undefined;
  private queue = Promise.resolve();
  constructor(private url: string, private transport: typeof fetch = fetch) {}
  execute(raw: unknown): Promise<Result> {
    let op: Operation;
    try { op = parseOperation(raw); }
    catch { return Promise.resolve({ ok: false, status: 400, message: "잘못된 요청입니다." }); }
    let result!: Result;
    const task = this.queue.then(async () => { result = await this.perform(op); });
    this.queue = task.catch(() => {});
    return task.then(() => result);
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
      const previous = this.credential;
      this.credential = undefined;
      if (previous) {
        const revoked = await this.request({ action: "logout" }, previous);
        if (!revoked.ok && revoked.status !== 401) return revoked;
      }
      if (op.action === "logout") return { ok: true, data: null };
    } else if (!this.credential) return { ok: false, status: 401, message: "로그인이 필요합니다." };
    const result = await this.request(op);
    if (!result.ok && result.status === 401) this.credential = undefined;
    if (op.action === "login" && result.ok) {
      const data = result.data as { credential: string; user: unknown };
      if (typeof data.credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.credential)) return { ok: false, status: 503, message: "잘못된 인증 서버 응답입니다." };
      this.credential = data.credential;
      return { ok: true, data: data.user };
    }
    return result;
  }
}
