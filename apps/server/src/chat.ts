import { ApiError } from './security';
import type { ChatInput, ChatEvent } from '../../../packages/shared-types/chat';
import type { chatStore } from './chat-store';
import type { openai } from './openai';
import type { documents } from './documents';
import type { Citation } from '../../../packages/shared-types/search';
import type { collaboration } from './collaboration';
export function chat(store: ReturnType<typeof chatStore>, provider: ReturnType<typeof openai>, docs?: Pick<ReturnType<typeof documents>, 'search' | 'verify'>, team?: Pick<ReturnType<typeof collaboration>, 'recordUsage'>) {
  return {
    async start(input: ChatInput, credential?: string) {
      // Ownership always precedes configuration/provider checks.
      await store.check(input.id, credential);
      provider.validate(input.model);
      if (input.documentSearch && !docs) throw new ApiError(503, '문서 검색 설정이 필요합니다.');
      const hits = input.documentSearch ? await docs!.search(input.text, credential) : [];
      const prepared = await store.prepare(input, credential);
      return {
        async *events(signal: AbortSignal): AsyncGenerator<ChatEvent> {
          let text = '';
          const citations: Citation[] = hits.map((h, i) => ({ kind: 'document', title: `[D${i + 1}] ${h.name}`, documentId: h.documentId, chunk: h.chunk, location: h.location }));
          const verify = async () => { if (hits.length) await docs!.verify(hits.map(h => h.documentId), credential); };
          try {
            await verify();
            if (citations.length) yield { type: 'sources', citations: [...citations] };
            for await (const delta of provider.stream(input, prepared.messages, signal, hits)) {
              signal.throwIfAborted();
              await store.check(input.id, credential);
              await verify();
              if (typeof delta !== 'string') {
                if ('usage' in delta) { if (team) await team.recordUsage(input.id, prepared.run, input.model, delta.usage, credential); continue; }
                citations.push(...delta.citations);
                yield { type: 'sources', citations: [...citations] };
                continue;
              }
              text += delta;
              if (text.length > 32_000) throw new ApiError(400, '응답 길이 한도를 초과했습니다.');
              yield { type: 'delta', text: delta };
            }
            signal.throwIfAborted();
            if (!text.trim()) throw new ApiError(503, 'AI 응답이 비어 있습니다. 다시 시도하세요.');
            await verify();
            await store.finish(input, prepared.run, text, credential, citations);
            yield { type: 'done' };
          } catch (error) {
            yield { type: 'error', status: error instanceof ApiError ? error.status : 503,
              message: error instanceof ApiError ? error.message : '응답이 중단되었습니다. 완료되지 않은 응답은 저장하지 않았습니다.' };
          } finally { await store.release(input.id, prepared.run, credential).catch(() => {}); }
        },
      };
    },
  };
}
