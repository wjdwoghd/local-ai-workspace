import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, symlink, chmod, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authFixture, login } from './support/auth-server';
import type { WorkspaceEvent } from '../../../../packages/shared-types/workspace';

const env = () => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RUN_AS_NODE'));
const packaged = process.env.TEST_WORKSPACE_PACKAGED_EXE;
const fixtureForRun = () => authFixture(false, packaged ? { cert: process.env.TEST_WORKSPACE_TLS_CERT!, key: process.env.TEST_WORKSPACE_TLS_KEY! } : undefined);
const launchOptions = (profile: string) => packaged ? { executablePath: resolve(packaged), args: [`--user-data-dir=${profile}`] } : { args: [resolve('.')] };
async function closeTestApp(app: ElectronApplication) {
  // Test cleanup must not wait on the app's intentional unsaved-edit close dialog.
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
}
async function edit(page: Page, text: string) {
  const input = page.getByTestId('workspace-editor').locator('textarea.inputarea').last();
  await input.focus(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(text);
}

test('local project UI: lazy tree, Monaco, saves, tabs, conflicts, external deletion and lifecycle', async () => {
  test.setTimeout(90000);
  const fixture = await fixtureForRun(); const root = await mkdtemp(join(tmpdir(), 'workspace-e2e-')); const profile = await mkdtemp(join(tmpdir(), 'workspace-profile-'));
  await mkdir(join(root, 'src')); await mkdir(join(root, 'node_modules'));
  await mkdir(join(root, 'constructor')); await writeFile(join(root, 'constructor', '__proto__'), 'unusual filename');
  await writeFile(join(root, 'src', 'hello.ts'), '\ufeffconst hello = "한글";\r\n');
  await writeFile(join(root, 'second.txt'), 'second\n'); await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  await writeFile(join(root, 'readonly.txt'), 'read only'); await chmod(join(root, 'readonly.txt'), 0o444);
  const app = await electron.launch({ ...launchOptions(profile), env: { ...env(), LOCAL_AI_TEST_PROFILE: profile, AUTH_SERVER_URL: fixture.url } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /worker/i.test(message.text())) errors.push(message.text()); });
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(!!packaged);
    await login(page, 'alice', fixture.password);
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [root] })) as typeof dialog.showOpenDialog; }, root);
    await page.getByRole('button', { name: '로컬 개발 환경', exact: true }).click();
    await page.getByRole('button', { name: '프로젝트 열기', exact: true }).click();
    const tree = page.getByRole('complementary', { name: '파일 탐색기' });
    await expect(tree.getByRole('button', { name: /src/ })).toBeVisible();
    await expect(tree).not.toContainText('node_modules'); await expect(tree).not.toContainText('hello.ts');
    await writeFile(join(root, 'created.txt'), 'created'); await expect(tree).toContainText('created.txt');
    await rename(join(root, 'created.txt'), join(root, 'renamed.txt')); await expect(tree).toContainText('renamed.txt'); await expect(tree).not.toContainText('created.txt');
    await unlink(join(root, 'renamed.txt')); await expect(tree).not.toContainText('renamed.txt');
    await tree.getByRole('button', { name: /constructor/ }).click(); await tree.getByRole('button', { name: /__proto__/ }).click();
    await expect(page.getByTestId('workspace-editor')).toContainText('unusual filename'); await page.getByRole('button', { name: '닫기 constructor/__proto__' }).click();
    await tree.getByRole('button', { name: /binary.bin/ }).click(); await expect(page.locator('.workspace-notice')).toContainText('바이너리');
    await tree.getByRole('button', { name: /large.txt/ }).click(); await expect(page.locator('.workspace-notice')).toContainText('2 MiB');
    await tree.getByRole('button', { name: /readonly.txt/ }).click(); await edit(page, 'readonly retained'); await page.keyboard.press('Control+S');
    await expect(page.locator('.workspace-notice')).toContainText('읽기 전용'); await expect(page.getByTestId('workspace-editor')).toContainText('readonly retained');
    await page.getByRole('button', { name: '닫기 readonly.txt' }).click(); await page.getByRole('dialog').getByRole('button', { name: '폐기', exact: true }).click();
    await tree.getByRole('button', { name: /src/ }).click(); await tree.getByRole('button', { name: /hello.ts/ }).click();
    await expect(page.getByTestId('workspace-editor')).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/workspace-editor.png' });
    await edit(page, 'const hello = "수정";\n');
    await page.keyboard.press('Control+S');
    await expect.poll(() => readFile(join(root, 'src', 'hello.ts'), 'utf8')).toBe('\ufeffconst hello = "수정";\r\n');
    await page.getByRole('button', { name: '저장본 비교', exact: true }).click(); await expect(page.locator('.monaco-diff-editor')).toBeVisible();
    await expect.poll(() => page.workers().length).toBeGreaterThan(0);
    expect(await page.workers()[0].evaluate(() => 1 + 1)).toBe(2);
    await page.getByRole('button', { name: '비교 닫기' }).click();
    await page.getByRole('button', { name: '닫기 src/hello.ts' }).click(); await tree.getByRole('button', { name: /hello.ts/ }).click();
    await expect(page.getByTestId('workspace-editor')).toContainText('수정');
    await tree.getByRole('button', { name: /second.txt/ }).click(); await expect(page.getByRole('tab')).toHaveCount(2);
    await edit(page, 'unsaved second'); await page.getByRole('button', { name: '닫기 second.txt' }).click();
    const modal = page.getByRole('dialog', { name: '저장하지 않은 변경' });
    await modal.getByRole('button', { name: '취소', exact: true }).click(); await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('button', { name: '닫기 second.txt' }).click(); await modal.getByRole('button', { name: '저장', exact: true }).click();
    await expect.poll(() => readFile(join(root, 'second.txt'), 'utf8')).toBe('unsaved second');
    await writeFile(join(root, 'src', 'hello.ts'), 'external clean\n');
    await expect(page.getByTestId('workspace-editor')).toContainText('external clean');
    await edit(page, 'local dirty'); await writeFile(join(root, 'src', 'hello.ts'), 'external conflict\n');
    await expect(page.getByText('외부 변경 충돌', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '디스크 비교', exact: true }).click();
    await expect(page.locator('.monaco-diff-editor')).toContainText('external conflict');
    await expect(page.locator('.monaco-diff-editor')).toContainText('local dirty');
    await page.getByRole('button', { name: '명시적 덮어쓰기', exact: true }).click();
    await expect.poll(() => readFile(join(root, 'src', 'hello.ts'), 'utf8')).toBe('local dirty');
    await page.getByRole('button', { name: '비교 닫기' }).click();
    await edit(page, 'retained after deletion'); await unlink(join(root, 'src', 'hello.ts'));
    await expect(page.locator('.workspace-page p[role="alert"]')).toContainText('편집 내용은 유지'); await expect(page.getByTestId('workspace-editor')).toContainText('retained after deletion');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await modal.getByRole('button', { name: '취소', exact: true }).click(); await expect(page.getByTestId('workspace-editor')).toBeVisible();
    await page.getByRole('button', { name: '프로젝트 전환', exact: true }).click(); await modal.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByTestId('workspace-editor')).toContainText('retained after deletion');
    await page.evaluate(() => { const target = window as unknown as { uiTerminalOutput: string }; target.uiTerminalOutput = ''; window.desktop.workspace.onEvent(e => { if (e.type === 'output') target.uiTerminalOutput += e.data; }); });
    await page.getByRole('button', { name: '터미널 시작·재시작' }).click();
    await expect(page.getByText('실행 중', { exact: true })).toBeVisible();
    const terminalInput = page.getByLabel('대화형 터미널').locator('textarea'); await terminalInput.focus();
    await page.keyboard.type("Write-Output ('UI_' + 'PTY')", { delay: 15 }); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as unknown as { uiTerminalOutput: string }).uiTerminalOutput)).toContain('UI_PTY');
    await page.screenshot({ path: 'test-results/workspace-editor-terminal.png' });
    await page.getByRole('button', { name: '채팅', exact: true }).click();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click(); await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: '폐기', exact: true }).click();
    await login(page, 'bob', fixture.password); await page.getByRole('button', { name: '로컬 개발 환경', exact: true }).click();
    await expect(page.getByRole('button', { name: '프로젝트 열기', exact: true })).toBeVisible(); await expect(page.getByRole('tab')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/workspace-isolated.png' });
  } finally { await closeTestApp(app); await fixture.close(); await chmod(join(root, 'readonly.txt'), 0o666); await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); }
});

test('real Electron IPC: path validation, actual ConPTY, resize, Ctrl+C, restart and account cleanup', async () => {
  test.setTimeout(90000);
  const fixture = await fixtureForRun(); const root = await mkdtemp(join(tmpdir(), 'workspace-pty-')); const outside = await mkdtemp(join(tmpdir(), 'workspace-out-')); const profile = await mkdtemp(join(tmpdir(), 'workspace-pty-profile-'));
  await writeFile(join(root, 'a.txt'), 'text'); await writeFile(join(outside, 'secret.txt'), 'private');
  await symlink(outside, join(root, 'escape'), 'junction');
  const app = await electron.launch({ ...launchOptions(profile), env: { ...env(), LOCAL_AI_TEST_PROFILE: profile, AUTH_SERVER_URL: fixture.url, LOCAL_AI_SECRET_SENTINEL: 'must-not-inherit' } });
  try {
    const page = await app.firstWindow();
    await expect(page.evaluate(() => window.desktop.workspace.pick())).rejects.toThrow('로그인');
    await login(page, 'alice', fixture.password);
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [root] })) as typeof dialog.showOpenDialog; }, root);
    const info = await page.evaluate(() => window.desktop.workspace.pick()); expect(info).toBeTruthy(); const id = info!.id;
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog; });
    expect(await page.evaluate(() => window.desktop.workspace.pick())).toBeNull();
    expect((await page.evaluate(id => window.desktop.workspace.read(id, 'a.txt'), id)).text).toBe('text');
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [root] })) as typeof dialog.showOpenDialog; }, root);
    for (const path of ['../secret.txt', 'C:/Windows/win.ini', 'a.txt:stream', 'escape/secret.txt']) await expect(page.evaluate(({ id, path }) => window.desktop.workspace.read(id, path), { id, path })).rejects.toThrow();
    await expect(page.evaluate(id => window.desktop.workspace.list(id, 1 as never), id)).rejects.toThrow();
    await expect(page.evaluate(id => window.desktop.workspace.terminalWrite(id, id, 'x'.repeat(8193)), id)).rejects.toThrow();
    const forged = await app.evaluate(async ({ ipcMain, BrowserWindow }, id) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers;
      const window = BrowserWindow.getAllWindows()[0];
      try { await handlers.get('desktop:workspace')!({ sender: window.webContents, senderFrame: { url: 'file:///forged' } }, { action: 'read', id, path: 'a.txt' }); return false; } catch { return true; }
    }, id); expect(forged).toBe(true);
    await page.evaluate(() => { const target = window as unknown as { testWorkspaceEvents: WorkspaceEvent[] }; target.testWorkspaceEvents = []; window.desktop.workspace.onEvent(event => target.testWorkspaceEvents.push(event)); });
    const terminal = await page.evaluate(id => window.desktop.workspace.terminalStart(id), id);
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalResize(id, terminal, 100, 32), { id, terminal });
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, "Write-Output ('PTY_' + 'READY'); (Get-Location).Path; Write-Output ('SECRET=' + $env:LOCAL_AI_SECRET_SENTINEL)\r"), { id, terminal });
    const output = () => page.evaluate(() => (window as unknown as { testWorkspaceEvents: WorkspaceEvent[] }).testWorkspaceEvents.filter(e => e.type === 'output').map(e => e.type === 'output' ? e.data : '').join(''));
    await expect.poll(output).toContain('PTY_READY'); await expect.poll(output).toContain(root);
    expect(await output()).not.toContain('must-not-inherit');
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, 'Start-Sleep -Seconds 30\r'), { id, terminal });
    await page.waitForTimeout(400); const beforeInterrupt = (await output()).length;
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, '\x03'), { id, terminal });
    await expect.poll(async () => (await output()).slice(beforeInterrupt)).toContain('PS ');
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, "Write-Output ('AFTER_' + 'INTERRUPT')\r"), { id, terminal });
    await expect.poll(output).toContain('AFTER_INTERRUPT');
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, 'exit 7\r'), { id, terminal });
    await expect.poll(() => page.evaluate(() => (window as unknown as { testWorkspaceEvents: WorkspaceEvent[] }).testWorkspaceEvents.some(e => e.type === 'exit' && e.code === 7))).toBe(true);
    const restarted = await page.evaluate(id => window.desktop.workspace.terminalStart(id), id); expect(restarted).not.toBe(terminal);
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, "Write-Output ('SHELLPID_' + $PID); $child = Start-Process powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; Write-Output ('CHILDPID_' + $child.Id)\r"), { id, terminal: restarted });
    await expect.poll(output).toMatch(/CHILDPID_\d+/);
    const running = await output(); const shellPid = Number(running.match(/SHELLPID_(\d+)/)![1]); const childPid = Number(running.match(/CHILDPID_(\d+)/)![1]);
    await expect(page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, 'bad'), { id, terminal })).rejects.toThrow();
    await app.evaluate(({ dialog }, outside) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [outside] })) as typeof dialog.showOpenDialog; }, outside);
    const switched = await page.evaluate(() => window.desktop.workspace.pick()); expect(switched!.id).not.toBe(id); expect(switched!.root).toBe(outside);
    await expect.poll(() => app.evaluate((_electron, ids) => ids.map(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), [shellPid, childPid])).toEqual([false, false]);
    await expect(page.evaluate(id => window.desktop.workspace.read(id, 'a.txt'), id)).rejects.toThrow();
    const newId = switched!.id; const newTerminal = await page.evaluate(id => window.desktop.workspace.terminalStart(id), newId);
    await page.evaluate(() => { (window as unknown as { testWorkspaceEvents: WorkspaceEvent[] }).testWorkspaceEvents = []; });
    await expect.poll(output).toContain('PS ');
    await page.evaluate(({ id, terminal }) => window.desktop.workspace.terminalWrite(id, terminal, "Write-Output ('LOGOUTPID_' + $PID)\r"), { id: newId, terminal: newTerminal });
    await expect.poll(output).toMatch(/LOGOUTPID_\d+/); const logoutPid = Number((await output()).match(/LOGOUTPID_(\d+)/)![1]);
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect.poll(() => app.evaluate((_electron, pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }, logoutPid)).toBe(false);
    await login(page, 'bob', fixture.password);
    await expect(page.evaluate(id => window.desktop.workspace.list(id, ''), newId)).rejects.toThrow();
    const bob = await page.evaluate(() => window.desktop.workspace.pick()); fixture.expire();
    await expect(page.evaluate(id => window.desktop.workspace.read(id, 'a.txt'), bob!.id)).rejects.toThrow();
    await expect(page.evaluate(id => window.desktop.workspace.terminalStart(id), bob!.id)).rejects.toThrow();
  } finally { await closeTestApp(app); await fixture.close(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); }
});

test('project cleanup works while the authentication server is unreachable', async () => {
  const fixture = await fixtureForRun(); const root = await mkdtemp(join(tmpdir(), 'workspace-offline-')); const profile = await mkdtemp(join(tmpdir(), 'workspace-offline-profile-'));
  const app = await electron.launch({ ...launchOptions(profile), env: { ...env(), LOCAL_AI_TEST_PROFILE: profile, AUTH_SERVER_URL: fixture.url } });
  let closed = false;
  try {
    const page = await app.firstWindow(); await login(page, 'alice', fixture.password);
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [root] })) as typeof dialog.showOpenDialog; }, root);
    const info = await page.evaluate(() => window.desktop.workspace.pick());
    await page.evaluate(id => window.desktop.workspace.terminalStart(id), info!.id);
    await fixture.close(); closed = true;
    await page.evaluate(id => window.desktop.workspace.close(id), info!.id);
    await expect(page.evaluate(id => window.desktop.workspace.list(id, ''), info!.id)).rejects.toThrow();
  } finally { await closeTestApp(app); if (!closed) await fixture.close(); await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); }
});
