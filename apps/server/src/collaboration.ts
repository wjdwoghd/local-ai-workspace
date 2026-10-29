import { activity } from './activity';
import { rows } from './database/oracle';
import { ApiError } from './security';
import type { service } from './service';
import { documentAccess } from './documents';
import type { CollaborationOperation, TokenUsage, UsageSummary } from '../../../packages/shared-types/collaboration';

export function collaboration(auth: Pick<ReturnType<typeof service>, 'withUser'>) {
  return {
    execute(op: CollaborationOperation, credential?: string) {
      return auth.withUser(credential, async (c, user) => {
        const owner = user.id;
        switch (op.action) {
          case 'recordGit': await activity(c, owner, `git.${op.operation}`, op.outcome); return null;
          case 'activity': return (await rows<{ ID: string; ACTION: string; OUTCOME: string; TIME: string }>(c, `SELECT id, action, outcome, TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time FROM s7_activity WHERE user_id = :owner ORDER BY created_at DESC, id FETCH FIRST 100 ROWS ONLY`, { owner })).map(r => ({ id: r.ID, action: r.ACTION, outcome: r.OUTCOME, time: r.TIME }));
          case 'shareDocument': {
            // Lock ownership and the relevant membership rows through the visibility update.
            const [doc] = await rows<{ TEAM_ID: string | null }>(c, `SELECT d.team_id FROM s4_documents d WHERE d.id = :id AND d.owner_id = :owner AND ${documentAccess} FOR UPDATE`, { id: op.id, owner });
            if (!doc) throw new ApiError(404, '문서가 없거나 변경 권한이 없습니다.');
            for (const team of [...new Set([doc.TEAM_ID, op.teamId].filter((t): t is string => !!t))].sort()) {
              if (!(await rows(c, 'SELECT team_id FROM s4_members WHERE team_id = :team AND user_id = :owner FOR UPDATE', { team, owner })).length) throw new ApiError(403, '원본·대상 팀의 현재 구성원이어야 합니다.');
            }
            await c.execute('UPDATE s4_documents SET team_id = :team WHERE id = :id AND owner_id = :owner', { team: op.teamId, id: op.id, owner });
            await activity(c, owner, op.teamId ? 'document.shared' : 'document.unshared'); return null;
          }
          case 'myUsage':
          case 'teamUsage': {
            if (op.action === 'teamUsage') {
              if (user.role !== 'admin' || !(await rows(c, 'SELECT team_id FROM s4_members WHERE team_id = :team AND user_id = :owner FOR UPDATE', { team: op.id, owner })).length) throw new ApiError(403, '소속 팀의 관리자만 집계할 수 있습니다.');
            }
            const filter = op.action === 'myUsage' ? 'u.user_id = :owner' : 'EXISTS (SELECT 1 FROM s4_members m WHERE m.team_id = :team AND m.user_id = u.user_id)';
            const [r] = await rows<{ RECORDS: number; INPUT: number | null; OUTPUT: number | null; TOTAL: number | null }>(c, `SELECT COUNT(*) AS records, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(total_tokens) AS total FROM s7_usage u WHERE ${filter}`, op.action === 'myUsage' ? { owner } : { team: op.id });
            return { records: r.RECORDS, input: r.INPUT, output: r.OUTPUT, total: r.TOTAL, cost: null, scope: op.action === 'myUsage' ? '서버 수집 시작 이후 개인 기록' : '현재 팀 구성원의 서버 수집 기록 합계' } satisfies UsageSummary;
          }
        }
      });
    },
    recordUsage(id: string, run: string, model: string, usage: TokenUsage, credential?: string) {
      return auth.withUser(credential, async (c, user) => {
        if (!(await rows(c, 'SELECT id FROM s2_conversations WHERE id = :id AND user_id = :owner', { id, owner: user.id })).length) throw new ApiError(404, '대화가 없습니다.');
        await c.execute(`MERGE INTO s7_usage u USING (SELECT :run run_id FROM dual) v ON (u.run_id = v.run_id)
          WHEN NOT MATCHED THEN INSERT (run_id, user_id, model, input_tokens, output_tokens, total_tokens) VALUES (:run, :owner, :model, :input, :output, :total)`, { run, owner: user.id, model, ...usage });
      });
    },
  };
}
