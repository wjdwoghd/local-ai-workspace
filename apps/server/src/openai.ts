import type { Config } from './config';
import type { ChatInput, ChatMessage } from '../../../packages/shared-types/chat';
import { sse } from '../../../packages/shared-types/sse';
import { ApiError } from './security';

export function openai(config: Pick<Config, 'openaiKey' | 'models'>, transport: typeof fetch = fetch) {
  return {
    validate(model: string) {
      if (!config.models.some(m => m.id === model)) throw new ApiError(400, '서버에서 허용한 모델을 선택하세요.');
      if (!config.openaiKey) throw new ApiError(503, '서버 API 키 설정이 필요합니다. 관리자에게 문의하세요.');
    },
    async *stream(input: ChatInput, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
      this.validate(input.model);
      const headers = { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' };
      // Check account visibility before sending conversation content; never substitute another ID.
      const access = await transport(`https://api.openai.com/v1/models/${encodeURIComponent(input.model)}`, { headers, signal, redirect: 'error' });
      if (!access.ok) throw new ApiError(access.status === 429 ? 429 : 503, '계정의 모델 접근 권한을 확인할 수 없습니다. 관리자에게 문의하세요.');
      const model = await access.json() as { id?: unknown };
      if (model.id !== input.model) throw new ApiError(503, '모델 ID 확인에 실패했습니다.');
      const response = await transport('https://api.openai.com/v1/responses', {
        method: 'POST', headers, signal, redirect: 'error',
        body: JSON.stringify({ model: input.model, stream: true, store: false, max_output_tokens: 4096,
          instructions: '사용자를 돕는 AI 어시스턴트입니다. 기본적으로 한국어로 답변하세요.',
          input: [...messages.map(m => ({ role: m.role, content: m.text })), { role: 'user', content: input.text }] }),
      });
      if (!response.ok || !response.body) throw new ApiError(response.status === 429 ? 429 : 503, 'AI 응답 요청에 실패했습니다. 모델 권한·사용량·서버 설정을 확인하세요.');
      let completed = false;
      for await (const raw of sse(response.body)) {
        const event = raw as { type?: string; delta?: string; response?: { status?: string; model?: string } };
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') yield event.delta;
        if (['error', 'response.failed', 'response.incomplete'].includes(event.type ?? '')) throw new ApiError(503, 'AI 응답이 완료되지 않았습니다. 다시 시도하세요.');
        if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed') throw new ApiError(503, 'AI 응답이 완료되지 않았습니다.');
          completed = true; break;
        }
      }
      if (!completed) throw new ApiError(503, 'AI 연결이 중단되었습니다. 다시 시도하세요.');
    },
  };
}
