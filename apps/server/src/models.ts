import type { ChatModel } from '../../../packages/shared-types/chat';
import { parseReasoning,reasoningLevels } from '../../../packages/shared-types/reasoning';

// Keep the built-in picker small. The first entry is the server default.
export function chatModels(env: NodeJS.ProcessEnv = process.env): ChatModel[] {
  const id = env.OPENAI_MODEL_ID?.trim() || 'gpt-6.1-sol';
  const astraId = env.OPENAI_ASTRA_MODEL_ID?.trim() || 'gpt-6-astra';
  const validId = (value: string) => value !== 'demo' && /^[a-zA-Z0-9._-]{1,100}$/.test(value);
  if (!validId(id) || !validId(astraId)) throw new Error('서버 모델 ID 형식 오류');
  const label = env.OPENAI_MODEL_LABEL?.trim() || (id === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : id === astraId ? 'Astra' : id);
  if (label.length > 50) throw new Error('서버 모델 표시명 형식 오류');
  const models: ChatModel[] = [{ id, label }];
  if (id !== 'gpt-6.1-sol') models.push({ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' });
  if (id !== astraId) models.push({ id: astraId, label: 'Astra' });
  // Additional entries remain an explicit operator setting; never list every API model.
  if (env.OPENAI_ADDITIONAL_MODELS) {
    let extra: unknown;
    try { extra = JSON.parse(env.OPENAI_ADDITIONAL_MODELS); } catch { throw new Error('OPENAI_ADDITIONAL_MODELS 형식 오류'); }
    if (!Array.isArray(extra) || extra.length > 8 || extra.some(m => !m || typeof m.id !== 'string' || !validId(m.id) || typeof m.label !== 'string' || !m.label.trim() || m.label.length > 50)) throw new Error('OPENAI_ADDITIONAL_MODELS 형식 오류');
    models.push(...extra);
    if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('중복 모델 ID');
  }
  for(const model of models)if(model.reasoningEfforts!==undefined){if(!Array.isArray(model.reasoningEfforts)||new Set(model.reasoningEfforts).size!==model.reasoningEfforts.length)throw new Error('서버 모델 추론 설정 오류');model.reasoningEfforts.forEach(parseReasoning);if(model.reasoningEfforts.includes('ultra')&&!model.reasoningEfforts.includes('max'))throw new Error('Ultra에는 Max 지원이 필요합니다.');}
  return models.map(model=>({...model,reasoningEfforts:reasoningLevels(model)}));
}
