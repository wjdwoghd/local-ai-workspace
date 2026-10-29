import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authFixture, login } from './support/auth-server';

test('agent local inspection, setup gate, mode change, stop and session cleanup (no real Codex)', async () => {
  test.setTimeout(60000);
  const packaged = process.env.TEST_WORKSPACE_PACKAGED_EXE;
  const fixture = await authFixture(false, packaged ? { cert: process.env.TEST_WORKSPACE_TLS_CERT!, key: process.env.TEST_WORKSPACE_TLS_KEY! } : undefined);
  const root = await mkdtemp(join(tmpdir(), 'agent-e2e-')); const profile = await mkdtemp(join(tmpdir(), 'agent-profile-'));
  await writeFile(join(root, 'a.ts'), 'const value = 1;');
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RUN_AS_NODE'));
  const app = await electron.launch({ ...(packaged ? { executablePath: resolve(packaged), args: [`--user-data-dir=${profile}`] } : { args: [resolve('.')] }), env: { ...env, LOCAL_AI_TEST_PROFILE: profile, AUTH_SERVER_URL: fixture.url } });
  try {
    const page = await app.firstWindow(); await login(page, 'alice', fixture.password);
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [root] })) as typeof dialog.showOpenDialog; }, root);
    await page.getByRole('button', { name: '로컬 개발 환경', exact: true }).click(); await page.getByRole('button', { name: '프로젝트 열기', exact: true }).click();
    const panel = page.getByRole('region', { name: 'AI 코딩 에이전트' });
    await expect(panel).toContainText('실제 Codex: 연결 안 됨');
    await page.getByRole('complementary', { name: '파일 탐색기' }).getByRole('button', { name: /a.ts/ }).click();
    await panel.getByRole('button', { name: '열린 파일 로컬 검사' }).click(); await expect(panel).toContainText('1개 파일을 로컬에서 검사');
    await panel.getByLabel('에이전트 모드').selectOption('edit'); await expect(panel).toContainText('승인한 수정만 허용');
    await panel.getByRole('button', { name: 'AI 연결 상태 확인' }).click(); await expect(panel).toContainText('서버 전용 인증 중계');
    await panel.getByLabel('에이전트 모드').selectOption('agent'); await expect(panel).toContainText('명령 격리 미검증');
    await panel.getByRole('button', { name: '에이전트 중단' }).click(); await expect(panel).toContainText('자동 롤백하지 않습니다');
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const value = 1;');
    const editor = page.getByTestId('workspace-editor').locator('textarea.inputarea').last(); await editor.focus(); await page.keyboard.press('Control+A'); await page.keyboard.insertText('unsaved');
    await expect(panel.getByRole('button', { name: '열린 파일 로컬 검사' })).toBeDisabled();
    await page.getByRole('button', { name: '닫기 a.ts' }).click(); await page.getByRole('dialog').getByRole('button', { name: '폐기', exact: true }).click();
    await page.getByRole('button', { name: '프로젝트 닫기', exact: true }).click(); await expect(panel).toHaveCount(0);
    const selected = await page.evaluate(() => window.desktop.workspace.pick());
    expect(selected).not.toBeNull();
    await page.evaluate(id => window.desktop.agent.execute({ action: 'analyze', id, mode: 'ask', paths: ['a.ts'] }), selected!.id);
    fixture.expire();
    await expect(page.evaluate(id => window.desktop.agent.execute({ action: 'status', id, mode: 'ask' }), selected!.id)).rejects.toThrow();
    await expect(page.evaluate(id => window.desktop.agent.execute({ action: 'stop', id, mode: 'agent' }), selected!.id)).rejects.toThrow();
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const value = 1;');
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(!!packaged);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close(); await fixture.close();
    await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});
