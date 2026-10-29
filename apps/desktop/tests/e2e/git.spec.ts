import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authFixture, login } from './support/auth-server';
test('Git UI stages selected files, reviews and commits, denies expired authentication (fixture server)', async () => {
  test.setTimeout(120000);
  const fixture = await authFixture(false); const root = await mkdtemp(join(tmpdir(), 'git-ui-')); const profile = await mkdtemp(join(tmpdir(), 'git-profile-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  git('init', '-b', 'main'); git('config', 'user.name', 'UI Test'); git('config', 'user.email', 'ui@example.invalid');
  await writeFile(join(root, 'selected.txt'), 'selected'); await writeFile(join(root, 'other.txt'), 'private'); await writeFile(join(root, '.env'), 'EMPTY=');
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RUN_AS_NODE'));
  const app = await electron.launch({ args: [resolve('.')], env: { ...env, LOCAL_AI_TEST_PROFILE: profile, AUTH_SERVER_URL: fixture.url } });
  try {
    const page = await app.firstWindow(); await login(page, 'alice', fixture.password);
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [root] })) as typeof dialog.showOpenDialog; }, root);
    await page.getByRole('button', { name: '로컬 개발 환경', exact: true }).click(); await page.getByRole('button', { name: '프로젝트 열기', exact: true }).click();
    await page.locator('.git-panel summary').click(); const panel = page.locator('.git-panel');
    await expect(panel).toContainText('현재 브랜치: main'); await expect(panel).toContainText('미연결');
    await expect(panel.getByRole('checkbox', { name: /.env/ })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /selected.txt/ }).check(); await panel.getByRole('button', { name: '선택 파일 스테이징 검토', exact: true }).click();
    const approval = page.getByRole('dialog', { name: 'Git 작업 승인' }); await expect(approval).toContainText('selected');
    expect(git('diff', '--cached', '--name-only')).toBe(''); await approval.getByRole('button', { name: '확인한 작업 실행', exact: true }).click();
    await expect(panel).toContainText('실행 완료'); expect(git('diff', '--cached', '--name-only').trim()).toBe('selected.txt');
    await panel.getByLabel('커밋 메시지').fill('feat: UI selected commit'); await panel.getByRole('button', { name: '스테이징 전체 커밋 검토', exact: true }).click();
    await expect(approval).toContainText('+selected'); await approval.getByRole('button', { name: '확인한 작업 실행', exact: true }).click(); await expect(panel).toContainText('실행 완료');
    expect(git('log', '-1', '--format=%s').trim()).toBe('feat: UI selected commit'); expect(git('ls-tree', '--name-only', 'HEAD').trim()).toBe('selected.txt'); expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe('private');
    await page.getByRole('button', { name: '팀 협업 · 사용량', exact: true }).click();
    await expect(page.getByRole('heading', { name: '내 API 사용량', exact: true })).toBeVisible();
    await expect(page.locator('.settings-page')).toContainText('총 토큰 확인 불가');
    await expect(page.getByRole('heading', { name: '허용된 팀 집계' })).toHaveCount(0);
    const selected = await page.evaluate(() => window.desktop.workspace.pick()); fixture.expire();
    await expect(page.evaluate(id => window.desktop.git({ action: 'status', id }), selected!.id)).rejects.toThrow();
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close(); await fixture.close();
    await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});
