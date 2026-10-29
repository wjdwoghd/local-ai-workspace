import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { extractDocument } from '../../src/document-parser';
import { parseUpload, safeWebURL } from '../../../../packages/shared-types/search';
import { parseOperation, type User } from '../../../../packages/shared-types/auth';
import { parseChat } from '../../../../packages/shared-types/chat';
import { openai } from '../../src/openai';
import { chat } from '../../src/chat';
import { documents } from '../../src/documents';
import { ApiError } from '../../src/security';
import { app } from '../../src/app';
import type oracledb from 'oracledb';
const signal = () => new AbortController().signal;
const collect = async <T>(source: AsyncIterable<T>) => { const a: T[] = []; for await (const x of source) a.push(x); return a; };
const archive = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
const input = { id: randomUUID(), text: '휴가 규정', model: 'gpt-6-astra', webSearch: true, documentSearch: true };
const hit = { documentId: randomUUID(), name: '정책.docx', chunk: 1, location: '문단 1', text: '휴가 20일' };

it('validates document/search boundaries and refuses unsafe source schemes', () => {
  expect(parseUpload({ name: '정책.pdf', base64: 'YQ==', teamId: null }).name).toBe('정책.pdf');
  for (const name of ['../x.pdf', 'C:\\x.pdf', 'x.exe', 'x.pdf\0']) expect(() => parseUpload({ name, base64: 'YQ==', teamId: null })).toThrow();
  expect(() => parseUpload({ name: 'x.txt', base64: '!', teamId: null })).toThrow();
  expect(() => parseOperation({ action: 'searchDocuments', query: 'x', owner: randomUUID() })).toThrow();
  expect(() => parseOperation({ action: 'addTeamMember', id: randomUUID(), userId: 'fake' })).toThrow();
  expect(() => parseChat({ ...input, webSearch: 'yes' })).toThrow();
  expect(safeWebURL('https://example.com/a')).toBe(true);
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://user:pass@example.com', 'ms-excel:ofe|u|https://example.com']) expect(safeWebURL(url)).toBe(false);
});
it('extracts Korean UTF-8 with line locations and refuses binary/empty text', async () => {
  expect(await extractDocument('메모.md', strToU8('안녕하세요\n휴가 20일'))).toEqual([{ location: '줄 1', text: '안녕하세요' }, { location: '줄 2', text: '휴가 20일' }]);
  await expect(extractDocument('bad.txt', Uint8Array.of(0xff))).rejects.toMatchObject({ status: 400 });
  await expect(extractDocument('empty.txt', strToU8('  '))).rejects.toMatchObject({ status: 400 });
});
it('extracts DOCX and PPTX in document order with XML entities and exact locations', async () => {
  const docx = archive({ 'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>휴가 &amp; </w:t></w:r><w:r><w:t>20일</w:t></w:r></w:p></w:body></w:document>' });
  expect(await extractDocument('정책.docx', docx)).toEqual([{ location: '문단 1', text: '휴가 & 20일' }]);
  const pptx = archive(Object.fromEntries([10, 2, 1].map(n => [`ppt/slides/slide${n}.xml`, `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>발표 ${n}</a:t></a:r></a:p></p:sld>`])));
  expect((await extractDocument('발표.pptx', pptx)).map(p => p.location)).toEqual(['슬라이드 1', '슬라이드 2', '슬라이드 10']);
});
it('resolves XLSX sheet relationships, rich shared strings, inline strings and cached numbers', async () => {
  const bytes = archive({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="급여" r:id="rId3" /></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Target="worksheets/sheet2.xml" /></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><r><t>김</t></r><r><t>철수</t></r></si></sst>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>100</v></c><c r="C2" t="inlineStr"><is><t>지급</t></is></c></row></sheetData></worksheet>',
  });
  expect(await extractDocument('급여.xlsx', bytes)).toEqual([{ location: '시트 급여 · 행 2', text: 'A2: 김철수 | B2: 100 | C2: 지급' }]);
});
it('extracts PDF page text using the actual parser', async () => {
  const stream = 'BT /F1 12 Tf 72 720 Td (Vacation 20 days) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  expect(await extractDocument('policy.pdf', strToU8(pdf))).toEqual([{ location: '페이지 1', text: 'Vacation 20 days' }]);
});
it('rejects malformed/oversized archives and entity declarations without exposing parser errors', async () => {
  const entity = archive({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><document><p><t>&secret;</t></p></document>' });
  await expect(extractDocument('evil.docx', entity)).rejects.toMatchObject({ status: 400 });
  await expect(extractDocument('fake.pdf', strToU8('not pdf'))).rejects.toMatchObject({ status: 400 });
  await expect(extractDocument('bomb.docx', zipSync({ 'word/document.xml': new Uint8Array(11 * 1024 * 1024) }))).rejects.toMatchObject({ status: 400 });
});
it('checks authentication/team membership before extraction and checks again before saving', async () => {
  const extract = vi.fn().mockResolvedValue([{ location: '줄 1', text: '휴가' }]);
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const user: User = { id: randomUUID(), username: 'alice', role: 'user', active: true };
  const withUser = vi.fn(async <T>(_credential: string | undefined, work: (c: oracledb.Connection, user: User) => Promise<T>) => work({ execute } as unknown as oracledb.Connection, user));
  const docs = documents({ withUser: withUser as Parameters<typeof documents>[0]['withUser'] }, extract);
  await expect(docs.upload({ name: 'x.txt', base64: 'YQ==', teamId: randomUUID() }, 'valid')).rejects.toMatchObject({ status: 403 });
  expect(extract).not.toHaveBeenCalled();
  withUser.mockRejectedValueOnce(new ApiError(401, 'expired'));
  await expect(docs.upload({ name: 'x.txt', base64: 'YQ==', teamId: null })).rejects.toMatchObject({ status: 401 });
  expect(extract).not.toHaveBeenCalled();
  execute.mockResolvedValueOnce({ rows: [{ TEAM_ID: 'team' }] }).mockResolvedValueOnce({ rows: [] });
  await expect(docs.upload({ name: 'x.txt', base64: 'YQ==', teamId: randomUUID() }, 'valid')).rejects.toMatchObject({ status: 403 });
  expect(extract).toHaveBeenCalledTimes(1);
});
it('uses bound terms and membership/ownership filters before limiting search results', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ ID: hit.documentId, NAME: hit.name, ORDINAL: 1, LOCATION: hit.location, CONTENT: hit.text }] });
  const withUser = async <T>(_credential: string | undefined, work: (c: oracledb.Connection, user: User) => Promise<T>) => work({ execute } as unknown as oracledb.Connection, { id: 'alice' } as User);
  expect(await documents({ withUser }).search("휴가 ' OR 1=1 --", 'valid')).toEqual([hit]);
  const [sql, binds] = execute.mock.calls[0];
  expect(sql).toContain('d.team_id IS NULL AND d.owner_id = :owner'); expect(sql).toContain('s4_members');
  expect(sql).not.toContain("휴가 '"); expect(binds).toMatchObject({ owner: 'alice', q0: '휴가' });
});
it('sends only authorized excerpts to Responses and parses safe web citation annotations', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ id: input.model })).mockResolvedValueOnce(new Response([
    { type: 'response.output_text.delta', delta: '휴가 20일 [D1]. 참조' },
    { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', title: '공식 정책', url: 'https://example.com/policy', start_index: 13, end_index: 15 }, { type: 'url_citation', url: 'file:///secret' }] }] }] } },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')));
  const provider = openai({ openaiKey: 'test-placeholder', models: [{ id: input.model, label: 'Astra' }] }, transport);
  const result = await collect(provider.stream(input, [], signal(), [hit]));
  expect(result.at(-1)).toEqual({ citations: [{ kind: 'web', title: '공식 정책', url: 'https://example.com/policy', start: 13, end: 15 }] });
  const body = JSON.parse(transport.mock.calls[1][1].body);
  expect(body.tools).toEqual([{ type: 'web_search' }]); expect(body.tool_choice).toBe('required'); expect(body.store).toBe(false);
  expect(body.input[0].content).toContain(hit.text); expect(body.input[0].content).not.toContain(hit.documentId);
});
it('carries document and web sources into saved turns and refuses revoked sources midstream', async () => {
  const store = { check: vi.fn(), prepare: vi.fn().mockResolvedValue({ run: 'r', messages: [] }), finish: vi.fn(), release: vi.fn(async () => {}) };
  const docs = { search: vi.fn().mockResolvedValue([hit]), verify: vi.fn() };
  const provider = { validate() {}, async *stream() { yield '휴가 20일 [D1]'; yield { citations: [{ kind: 'web' as const, title: '공식', url: 'https://example.com' }] }; } };
  const events = await collect((await chat(store, provider, docs).start(input, 'valid')).events(signal()));
  expect(events.at(-1)).toEqual({ type: 'done' });
  expect(store.finish.mock.calls[0][4]).toHaveLength(2);
  store.finish.mockClear(); docs.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(403, 'revoked'));
  const revoked = await collect((await chat(store, provider, docs).start(input, 'valid')).events(signal()));
  expect(revoked.at(-1)).toMatchObject({ type: 'error', status: 403 });
  expect(revoked.some(e => e.type === 'delta')).toBe(false); expect(store.finish).not.toHaveBeenCalled();
});
it('serves bounded authenticated uploads with no caching and sanitized failures', async () => {
  const upload = vi.fn().mockRejectedValue(new ApiError(401, '로그인 필요'));
  const server = app({ execute: vi.fn() }, undefined, { upload } as unknown as ReturnType<typeof documents>);
  try {
    const response = await server.inject({ method: 'POST', url: '/api/documents', payload: { name: 'x.txt', base64: 'YQ==', teamId: null } });
    expect(response.statusCode).toBe(401); expect(response.headers['cache-control']).toBe('no-store');
    const invalid = await server.inject({ method: 'POST', url: '/api/documents', payload: { name: '../x.txt', base64: 'YQ==', teamId: null } });
    expect(invalid.statusCode).toBe(400); expect(upload).toHaveBeenCalledTimes(1);
  } finally { await server.close(); }
});
