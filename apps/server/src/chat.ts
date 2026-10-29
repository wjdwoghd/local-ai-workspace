import { ApiError } from './security';
import type { ChatInput, ChatEvent } from '../../../packages/shared-types/chat';
import type { chatStore } from './chat-store';
import type { openai } from './openai';
export function chat(store: ReturnType<typeof chatStore>, provider: ReturnType<typeof openai>) {
  return {
    async start(input: ChatInput, credential?: string) {
      // Ownership always precedes configuration/provider checks.
      await store.check(input.id, credential);
      provider.validate(input.model);
      const prepared = await store.prepare(input, credential);
      return {
        async *events(signal: AbortSignal): AsyncGenerator<ChatEvent> {
          let text = '';
          try {
            for await (const delta of provider.stream(input, prepared.messages, signal)) {
              signal.throwIfAborted();
              await store.check(input.id, credential);
              text += delta;
              if (text.length > 32_000) throw new ApiError(400, '응답 길이 한도를 초과했습니다.');
              yield { type: 'delta', text: delta };
            }
            signal.throwIfAborted();
            if (!text.trim()) throw new ApiError(503, 'AI 응답이 비어 있습니다. 다시 시도하세요.');
            await store.finish(input, prepared.run, text, credential);
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
