import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { showMode } from './support/mode-ui';

test('terminal displays the initial PowerShell prompt even before the start reply arrives', async () => {
  test.setTimeout(180000);
  const profile = await mkdtemp(join(tmpdir(), 'terminal-start-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !['ELECTRON_RUN_AS_NODE', 'OPENAI_API_KEY', 'LOCAL_AI_CONNECTION_FILE', 'AUTH_SERVER_URL'].includes(key)));
  const packaged = process.env.TEST_LOCAL_PACKAGED_EXE;
  const app = await electron.launch({
    timeout: 90000,
    ...(packaged ? { executablePath: resolve(packaged), args: [`--user-data-dir=${profile}`] } : { args: [resolve('.')] }),
    env: { ...env, LOCAL_WORKSPACE_MODE: '1', LOCAL_AI_TEST_PROFILE: profile, LOCAL_WORKSPACE_ROSTER_FILE: '' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel('새 팀원 이름').fill('터미널테스트');
    await page.getByRole('button', { name: '개인 작업 공간 만들기' }).click();
    await page.getByRole('button', { name: '작업 공간 열기', exact: true }).click();
    await showMode(page, 'Work');
    await page.getByRole('button', { name: '내 작업 폴더 열기', exact: true }).click();
    // Slow only the invoke reply, so real PTY output reaches the renderer first.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: any[]) => any> })._invokeHandlers;
      const original = handlers.get('desktop:workspace')!;
      ipcMain.removeHandler('desktop:workspace');
      ipcMain.handle('desktop:workspace', async (event, request) => {
        const result = await original(event, request);
        if (request.action === 'terminal-start') await new Promise(resolve => setTimeout(resolve, 1500));
        return result;
      });
    });
    await page.getByRole('button', { name: '터미널 시작·재시작' }).click();
    const screen = page.getByLabel('대화형 터미널');
    await expect(screen).toContainText('PS ');
    await screen.locator('textarea').focus();
    await page.keyboard.type("Write-Output ('TERMINAL_' + 'OK')");
    await page.keyboard.press('Enter');
    await expect(screen).toContainText('TERMINAL_OK');
    await page.getByRole('button', { name: '터미널 시작·재시작' }).click();
    await expect(page.getByRole('button', { name: '터미널 시작·재시작' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '터미널 시작·재시작' })).toBeEnabled();
    await expect(screen).toContainText('PS ');
    await screen.locator('textarea').focus();
    await page.keyboard.type("Write-Output ('RESTART_' + 'OK')");
    await page.keyboard.press('Enter');
    await expect(screen).toContainText('RESTART_OK');
    await page.screenshot({ path: 'test-results/terminal-start.png' });
  } finally {
    for (const page of app.windows()) await page.evaluate(() => window.desktop.profiles({ action: 'leave' })).catch(() => {});
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
