import { it, expect, vi } from 'vitest';
import { CodexAdapter } from '../../../../packages/agent-core/adapters/codex.adapter';
function fixture(timeout = 1000) { const sent: Record<string, any>[] = []; const close = vi.fn(); const events = vi.fn(); const adapter = new CodexAdapter({ send: line => sent.push(JSON.parse(line)), close }, events, timeout); const reply = (result: unknown) => adapter.feed(JSON.stringify({ id: sent.at(-1)!.id, result }) + '\n'); return { adapter, sent, close, events, reply }; }
it('fixture: initialize/thread/turn, fragmented stream, deny native tools, interrupt and close', async () => {
  const f = fixture(); const init = f.adapter.initialize(); f.reply({ userAgent: 'fixture' }); await init;
  expect(f.sent.at(-1)!.method).toBe('initialized');
  const thread = f.adapter.startThread('fixture-only-model', 'C:/fixture'); f.reply({ thread: { id: 't' } }); await thread;
  const turn = f.adapter.startTurn('analyze'); f.reply({ turn: { id: 'u' } }); await turn;
  const line = JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'u', delta: '한글' } }) + '\n';
  f.adapter.feed(line.slice(0, 30)); expect(f.events).not.toHaveBeenCalled(); f.adapter.feed(line.slice(30)); expect(f.events).toHaveBeenCalledTimes(1);
  const approval = JSON.stringify({ id: 80, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'x' } }) + '\n';
  f.adapter.feed(approval); f.adapter.feed(approval); expect(f.sent.filter(m => m.id === 80)).toEqual([{ id: 80, result: { decision: 'decline' } }]);
  f.adapter.feed(JSON.stringify({ id: 81, method: 'item/commandExecution/requestApproval', params: {} }) + '\n'); expect(f.sent.at(-1)!.result).toEqual({ decision: 'decline' });
  f.adapter.feed(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'u', delta: 'leak' } }) + '\n'); expect(f.events).toHaveBeenCalledTimes(1);
  const stop = f.adapter.interrupt(); expect(f.sent.at(-1)!.method).toBe('turn/interrupt'); f.reply({}); await stop;
  f.adapter.close(); f.adapter.feed(line); expect(f.close).toHaveBeenCalledOnce(); expect(f.events).toHaveBeenCalledTimes(1);
});
it.each(['not-json\n', '[]\n', '{"method":"x","params":null}\n', 'x'.repeat(1048577)])('fixture: malformed stream closes transport', value => { const f = fixture(); f.adapter.feed(value); expect(f.close).toHaveBeenCalledOnce(); });
it('fixture: process exit and timeout reject pending requests', async () => {
  const f = fixture(); const init = f.adapter.initialize(); f.adapter.close('process exited'); await expect(init).rejects.toThrow('process exited');
  const timeout = fixture(5); await expect(timeout.adapter.initialize()).rejects.toThrow('timeout'); expect(timeout.close).toHaveBeenCalledOnce();
});
it('fixture: split UTF-8 bytes survive framing and invalid encoding closes', async () => {
  const f = fixture(); const init = f.adapter.initialize();
  const bytes = new TextEncoder().encode(JSON.stringify({ id: 1, result: { userAgent: '한글' } }) + '\n');
  for (const byte of bytes) f.adapter.feed(Uint8Array.of(byte)); await init;
  f.adapter.feed(Uint8Array.of(0xff)); expect(f.close).toHaveBeenCalledOnce();
});
