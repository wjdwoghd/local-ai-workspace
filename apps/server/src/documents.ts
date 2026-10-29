import { randomUUID } from 'node:crypto';
import type oracledb from 'oracledb';
import type { service } from './service';
import { rows } from './database/oracle';
import { ApiError } from './security';
import { extractDocument } from './document-parser';
import { activity } from './activity';
import { MAX_FILE_BYTES, type DocumentMeta, type SearchHit, type SearchOperation, type Team, type UploadInput } from '../../../packages/shared-types/search';

// Private documents belong only to their owner. Team documents require current membership, even for their uploader/admin.
export const documentAccess = `(d.team_id IS NULL AND d.owner_id = :owner OR d.team_id IS NOT NULL AND EXISTS
  (SELECT 1 FROM s4_members m WHERE m.team_id = d.team_id AND m.user_id = :owner))`;
type DocRow = { ID: string; NAME: string; OWNER_ID: string; TEAM_ID: string | null; CHUNK_COUNT: number };
const meta = (r: DocRow): DocumentMeta => ({ id: r.ID, name: r.NAME, owner: r.OWNER_ID, teamId: r.TEAM_ID, chunks: r.CHUNK_COUNT });
export function documents(auth: Pick<ReturnType<typeof service>, 'withUser'>, extract = extractDocument) {
  async function teamAccess(c: oracledb.Connection, owner: string, team: string | null) {
    if (!team) return;
    if (!(await rows(c, 'SELECT team_id FROM s4_members WHERE team_id = :team AND user_id = :owner', { team, owner })).length) throw new ApiError(403, '팀 문서에 접근할 권한이 없습니다.');
  }
  return {
    async upload(input: UploadInput, credential?: string) {
      await auth.withUser(credential, (c, user) => teamAccess(c, user.id, input.teamId));
      const bytes = Buffer.from(input.base64, 'base64');
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new ApiError(400, '문서는 최대 10MB입니다.');
      const parts = await extract(input.name, bytes);
      return auth.withUser(credential, async (c, user) => {
        await teamAccess(c, user.id, input.teamId);
        const [count] = await rows<{ TOTAL: number }>(c, 'SELECT COUNT(*) AS total FROM s4_documents WHERE owner_id = :owner', { owner: user.id });
        if (count.TOTAL >= 100) throw new ApiError(400, '개인별 등록 문서는 최대 100개입니다.');
        const id = randomUUID();
        await c.execute('INSERT INTO s4_documents (id, owner_id, team_id, name, chunk_count) VALUES (:id, :owner, :team, :name, :chunks)', { id, owner: user.id, team: input.teamId, name: input.name, chunks: parts.length });
        await c.executeMany('INSERT INTO s4_chunks (document_id, ordinal, location, content) VALUES (:id, :ordinal, :location, :content)', parts.map((part, i) => ({ id, ordinal: i + 1, location: part.location.slice(0, 200), content: part.text })));
        await activity(c, user.id, input.teamId ? 'document.shared-upload' : 'document.private-upload');
        return { id, owner: user.id, teamId: input.teamId, name: input.name, chunks: parts.length } satisfies DocumentMeta;
      });
    },
    async search(query: string, credential?: string): Promise<SearchHit[]> {
      return auth.withUser(credential, async (c, user) => {
        const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].slice(0, 8);
        if (!terms.length) return [];
        const binds: Record<string, string> = { owner: user.id };
        terms.forEach((term, i) => { binds[`q${i}`] = term.slice(0, 100); });
        const score = terms.map((_term, i) => `(CASE WHEN INSTR(LOWER(ch.content), :q${i}) > 0 THEN 1 ELSE 0 END)`).join(' + ');
        const found = await rows<{ ID: string; NAME: string; ORDINAL: number; LOCATION: string; CONTENT: string }>(c, `SELECT d.id, d.name, ch.ordinal, ch.location, ch.content FROM s4_documents d JOIN s4_chunks ch ON ch.document_id = d.id
          WHERE ${documentAccess} AND (${score}) > 0 ORDER BY (${score}) DESC, d.id, ch.ordinal FETCH FIRST 6 ROWS ONLY`, binds);
        return found.map(r => ({ documentId: r.ID, name: r.NAME, chunk: r.ORDINAL, location: r.LOCATION, text: r.CONTENT }));
      });
    },
    async verify(ids: string[], credential?: string) {
      await auth.withUser(credential, async (c, user) => {
        for (const id of new Set(ids)) if (!(await rows(c, `SELECT d.id FROM s4_documents d WHERE d.id = :id AND ${documentAccess}`, { id, owner: user.id })).length) throw new ApiError(403, '문서 권한이 변경되었습니다. 다시 검색하세요.');
      });
    },
    async execute(op: SearchOperation, credential?: string): Promise<unknown> {
      if (op.action === 'searchDocuments') return this.search(op.query, credential);
      return auth.withUser(credential, async (c, user) => {
        const owner = { owner: user.id };
        switch (op.action) {
          case 'documents': return (await rows<DocRow>(c, `SELECT d.id, d.name, d.owner_id, d.team_id, d.chunk_count FROM s4_documents d WHERE ${documentAccess} ORDER BY d.name, d.id`, owner)).map(meta);
          case 'teams': return (await rows<{ ID: string; NAME: string }>(c, 'SELECT t.id, t.name FROM s4_teams t JOIN s4_members m ON m.team_id = t.id WHERE m.user_id = :owner ORDER BY t.name', owner)).map(r => ({ id: r.ID, name: r.NAME } satisfies Team));
          case 'readDocument': {
            const [doc] = await rows<DocRow>(c, `SELECT d.* FROM s4_documents d WHERE d.id = :id AND ${documentAccess}`, { ...owner, id: op.id });
            if (!doc) throw new ApiError(404, '문서를 찾을 수 없습니다.');
            const parts = await rows<{ ORDINAL: number; LOCATION: string; CONTENT: string }>(c, 'SELECT ordinal, location, content FROM s4_chunks WHERE document_id = :id ORDER BY ordinal', { id: op.id });
            return { ...meta(doc), parts: parts.map(r => ({ chunk: r.ORDINAL, location: r.LOCATION, text: r.CONTENT })) };
          }
          case 'deleteDocument': {
            const result = await c.execute(`DELETE FROM s4_documents d WHERE d.id = :id AND d.owner_id = :owner AND ${documentAccess}`, { ...owner, id: op.id });
            if (!result.rowsAffected) throw new ApiError(404, '문서를 찾을 수 없거나 삭제 권한이 없습니다.');
            await activity(c, user.id, 'document.deleted');
            return null;
          }
          case 'createTeam': {
            if (user.role !== 'admin') throw new ApiError(403, '관리자 권한이 필요합니다.');
            const id = randomUUID();
            await c.execute('INSERT INTO s4_teams (id, name) VALUES (:id, :name)', { id, name: op.name.trim() });
            await c.execute('INSERT INTO s4_members (team_id, user_id) VALUES (:id, :owner)', { ...owner, id });
            return { id, name: op.name.trim() };
          }
          case 'addTeamMember':
          case 'removeTeamMember': {
            if (user.role !== 'admin') throw new ApiError(403, '관리자 권한이 필요합니다.');
            if (!(await rows(c, 'SELECT id FROM s4_teams WHERE id = :id FOR UPDATE', { id: op.id })).length) throw new ApiError(404, '팀을 찾을 수 없습니다.');
            if (!(await rows(c, 'SELECT id FROM s2_users WHERE id = :id AND active = 1', { id: op.userId })).length) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
            const binds = { id: op.id, member: op.userId };
            if (op.action === 'removeTeamMember') await c.execute('DELETE FROM s4_members WHERE team_id = :id AND user_id = :member', binds);
            else await c.execute(`MERGE INTO s4_members m USING (SELECT :id team_id, :member user_id FROM dual) v ON (m.team_id = v.team_id AND m.user_id = v.user_id)
              WHEN NOT MATCHED THEN INSERT (team_id, user_id) VALUES (v.team_id, v.user_id)`, binds);
            return null;
          }
        }
      });
    },
  };
}
