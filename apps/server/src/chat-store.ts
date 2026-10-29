import { randomUUID } from 'node:crypto';
import oracledb from 'oracledb';
import { rows } from './database/oracle';
import { ApiError } from './security';
import type { ChatInput, ChatMessage } from '../../../packages/shared-types/chat';
import type { service } from './service';
import type { Citation } from '../../../packages/shared-types/search';

export async function history(c: oracledb.Connection, id: string): Promise<ChatMessage[]> {
  const result = await c.execute<{ ID: string; ROLE: ChatMessage['role']; CONTENT: string; MODEL: string; CITATIONS: string | null }>(
    'SELECT m.id, m.role, m.content, m.model, s.content AS citations FROM s3_messages m LEFT JOIN s4_citations s ON s.message_id = m.id WHERE m.conversation_id = :id ORDER BY m.ordinal', { id },
    { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { CONTENT: { type: oracledb.STRING }, CITATIONS: { type: oracledb.STRING } }, maxRows: 202 });
  return (result.rows ?? []).map(r => ({ id: r.ID, role: r.ROLE, text: r.CONTENT, model: r.MODEL, ...(r.CITATIONS ? { citations: JSON.parse(r.CITATIONS) as Citation[] } : {}) }));
}
export function chatStore(auth: Pick<ReturnType<typeof service>, 'withUser'>) {
  const owned = async (c: oracledb.Connection, owner: string, id: string) => {
    const [r] = await rows(c, 'SELECT id FROM s2_conversations WHERE id = :id AND user_id = :owner', { id, owner });
    if (!r) throw new ApiError(404, '리소스를 찾을 수 없습니다.');
  };
  return {
    async prepare(input: ChatInput, credential?: string) {
      return auth.withUser(credential, async (c, user) => {
        await owned(c, user.id, input.id);
        const [busy] = await rows(c, 'SELECT run_id FROM s3_generations WHERE conversation_id = :id AND expires_at > SYS_EXTRACT_UTC(SYSTIMESTAMP)', { id: input.id });
        if (busy) throw new ApiError(409, '이 대화에서 응답을 생성 중입니다. 잠시 후 다시 시도하세요.');
        const messages = await history(c, input.id);
        if (messages.length >= 200 || messages.reduce((n, m) => n + m.text.length, input.text.length) > 100_000) throw new ApiError(400, '대화 길이 한도에 도달했습니다. 새 대화를 시작하세요.');
        const run = randomUUID();
        await c.execute('DELETE FROM s3_generations WHERE conversation_id = :id', { id: input.id });
        await c.execute("INSERT INTO s3_generations (conversation_id, run_id, expires_at) VALUES (:id, :run, SYS_EXTRACT_UTC(SYSTIMESTAMP) + INTERVAL '3' MINUTE)", { id: input.id, run });
        return { run, messages };
      });
    },
    async check(id: string, credential?: string) {
      await auth.withUser(credential, (c, user) => owned(c, user.id, id));
    },
    async finish(input: ChatInput, run: string, text: string, credential?: string, citations: Citation[] = []) {
      await auth.withUser(credential, async (c, user) => {
        await owned(c, user.id, input.id);
        const [lease] = await rows(c, 'SELECT run_id FROM s3_generations WHERE conversation_id = :id AND run_id = :run AND expires_at > SYS_EXTRACT_UTC(SYSTIMESTAMP)', { id: input.id, run });
        if (!lease) throw new ApiError(409, '응답 저장 기한이 지났습니다. 다시 시도하세요.');
        const [count] = await rows<{ TOTAL: number }>(c, 'SELECT COUNT(*) AS total FROM s3_messages WHERE conversation_id = :id', { id: input.id });
        for (const [offset, role, content] of [[1, 'user', input.text], [2, 'assistant', text]] as const) {
          const mid = randomUUID();
          await c.execute('INSERT INTO s3_messages (id, conversation_id, ordinal, role, content, model) VALUES (:mid, :id, :ordinal, :role, :content, :model)',
            { mid, id: input.id, ordinal: count.TOTAL + offset, role, content: { val: content, type: oracledb.CLOB }, model: input.model });
          if (role === 'assistant' && citations.length) await c.execute('INSERT INTO s4_citations (message_id, content) VALUES (:id, :content)', { id: mid, content: { val: JSON.stringify(citations), type: oracledb.CLOB } });
        }
        if (!count.TOTAL) await c.execute('UPDATE s2_conversations SET title = :title WHERE id = :id AND user_id = :owner', { id: input.id, owner: user.id, title: input.text.slice(0, 28) });
        await c.execute('DELETE FROM s3_generations WHERE conversation_id = :id AND run_id = :run', { id: input.id, run });
      });
    },
    async release(id: string, run: string, credential?: string) {
      await auth.withUser(credential, async (c, user) => {
        await owned(c, user.id, id);
        await c.execute('DELETE FROM s3_generations WHERE conversation_id = :id AND run_id = :run', { id, run });
      });
    },
  };
}
