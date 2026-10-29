// Subset verified with codex-cli 0.162.0-alpha.17.2 generate-ts.
// Host owns transport. No production process launcher or credentials are installed.
export interface CodexTransport { send(line: string): void; close(): void }
export interface CodexEvent { method: string; params: Record<string, unknown> }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export class CodexAdapter {
  private buffer = ''; private sequence = 0; private closed = false; private ready = false;
  private thread?: string; private turn?: string; private output = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private approvals = new Set<string | number>();
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private turnTimer?: ReturnType<typeof setTimeout>;
  constructor(private transport: CodexTransport, private event: (event: CodexEvent) => void, private timeoutMs = 10000, private turnTimeoutMs = 120000) {}
  private send(value: unknown) { if (this.closed) throw new Error('Codex connection closed'); this.transport.send(JSON.stringify(value) + '\n'); }
  private request(method: string, params: unknown): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error('Codex connection closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close('Codex request timeout'), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch { this.close('Codex transport failure'); }
    });
  }
  async initialize() {
    if (this.ready) throw new Error('Already initialized');
    await this.request('initialize', { clientInfo: { name: 'local_ai_workspace', title: 'Local AI Workspace', version: '0.1.0' }, capabilities: null });
    this.send({ method: 'initialized' }); this.ready = true;
  }
  async startThread(model: string, cwd: string) {
    if (!this.ready || this.thread || !model.trim()) throw new Error('Explicit verified model and initialized connection required');
    const result = await this.request('thread/start', { model, cwd, sandbox: 'read-only', approvalPolicy: 'untrusted', ephemeral: true });
    if (!object(result.thread) || typeof result.thread.id !== 'string') { this.close(); throw new Error('Invalid thread response'); }
    this.thread = result.thread.id; return this.thread;
  }
  async startTurn(text: string) {
    if (!this.thread || this.turn || !text || text.length > 262144) throw new Error('Invalid turn lifecycle');
    this.turn = 'pending'; this.output = 0;
    this.turnTimer = setTimeout(() => this.close('Codex turn timeout'), this.turnTimeoutMs);
    let result: Record<string, unknown>;
    try { result = await this.request('turn/start', { threadId: this.thread, input: [{ type: 'text', text, text_elements: [] }] }); }
    catch (error) { this.close('Turn start failed'); throw error; }
    if (!object(result.turn) || typeof result.turn.id !== 'string') { this.close(); throw new Error('Invalid turn response'); }
    this.turn = result.turn.id; return this.turn;
  }
  async interrupt() {
    if (this.turn === 'pending') { this.close('Interrupted during turn start'); return; }
    if (this.thread && this.turn) {
      try { await this.request('turn/interrupt', { threadId: this.thread, turnId: this.turn }); }
      catch (error) { this.close('Interrupt failed'); throw error; }
    }
  }
  feed(chunk: string | Uint8Array) {
    if (this.closed) return;
    try { this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true }); }
    catch { this.close('Invalid UTF-8 stream'); return; }
    if (this.buffer.length > 1048576) { this.close('Codex frame limit'); return; }
    try {
      for (let index; (index = this.buffer.indexOf('\n')) >= 0;) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        const m: unknown = JSON.parse(line);
        if (!object(m)) throw new Error('Invalid message');
        if (typeof m.method !== 'string') {
          if (typeof m.id !== 'number' || (!object(m.result) && !object(m.error))) throw new Error('Invalid response');
          const p = this.pending.get(m.id); if (!p) continue;
          clearTimeout(p.timer); this.pending.delete(m.id);
          if (m.error) p.reject(new Error('Codex request failed')); else p.resolve(m.result as Record<string, unknown>);
          continue;
        }
        if (!object(m.params)) throw new Error('Invalid notification');
        if ('id' in m) {
          if (typeof m.id !== 'string' && typeof m.id !== 'number') throw new Error('Invalid request ID');
          if (this.approvals.has(m.id)) continue;
          if (this.approvals.size >= 1000) throw new Error('Request limit');
          this.approvals.add(m.id);
          if (m.method === 'item/commandExecution/requestApproval' || m.method === 'item/fileChange/requestApproval') this.send({ id: m.id, result: { decision: 'decline' } });
          else this.send({ id: m.id, error: { code: -32601, message: 'Unsupported tool request' } });
          continue;
        }
        if (m.params.threadId !== this.thread || !this.thread) continue;
        if (m.params.turnId !== undefined && m.params.turnId !== this.turn) continue;
        if (m.method === 'turn/completed') {
          if (!object(m.params.turn) || m.params.turn.id !== this.turn) continue;
          clearTimeout(this.turnTimer); this.turnTimer = undefined;
          this.turn = undefined;
        }
        if (!['item/agentMessage/delta', 'turn/completed', 'turn/started', 'error'].includes(m.method)) continue;
        this.output += line.length; if (this.output > 1048576) throw new Error('Output limit');
        this.event({ method: m.method, params: m.params });
      }
    } catch { this.close('Malformed or oversized Codex stream'); }
  }
  close(reason = 'Codex disconnected') {
    if (this.closed) return; this.closed = true; this.ready = false; this.thread = this.turn = undefined; this.buffer = ''; this.approvals.clear();
    clearTimeout(this.turnTimer); this.turnTimer = undefined;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); } this.pending.clear();
    this.transport.close();
  }
}
