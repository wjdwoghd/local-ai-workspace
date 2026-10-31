import { showMode, openAppTool, closeAppTool } from './support/mode-ui';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { authFixture, login } from './support/auth-server';

test('VS Code workbench: mouse sashes, Material icons, unified input, both real shells and disconnected tools', async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'workbench-ui-')), profile = join(root, 'profile'), project = join(root, 'project');
  await mkdir(project); await writeFile(join(project, 'hello.ts'), 'const greeting = "workbench needle";');
  await writeFile(join(project, 'readme.md'), '# Search example'); await writeFile(join(project, '.env'), 'needle=private');
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string] => e[1] !== undefined && e[0] !== 'ELECTRON_RUN_AS_NODE'));
  const packaged = process.env.TEST_LOCAL_PACKAGED_EXE;
  const app = await electron.launch({ ...(packaged ? { executablePath:resolve(packaged), args:[`--user-data-dir=${profile}`] } : {args:[resolve('.')]}), env:{ ...env, LOCAL_WORKSPACE_MODE:'1', LOCAL_AI_TEST_PROFILE:profile, LOCAL_WORKSPACE_ROSTER_FILE:'' } });
  try {
    const page = await app.firstWindow(); const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.getByLabel('새 팀원 이름').fill('홍길동'); await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();
    await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await showMode(page,'Work');
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[project]})) as typeof dialog.showOpenDialog;},project);
    await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
    await expect(page.getByRole('navigation',{name:'활동 표시줄'})).toBeVisible();
    const tree = page.getByRole('complementary',{name:'파일 탐색기'});
    await expect(tree.locator('img[data-icon=typescript]')).toBeVisible(); await expect(tree.locator('img[data-icon=markdown]')).toBeVisible();
    await tree.getByRole('button',{name:'hello.ts',exact:true}).click();
    await expect(page.getByRole('tab',{name:'hello.ts',exact:true}).locator('img')).toHaveAttribute('data-icon','typescript');
    for (const [name,dx,dy] of [['사이드바 크기',35,0],['챗봇 크기',-40,0],['터미널 크기',0,-40]] as const) {
      const sash=page.getByRole('separator',{name}), before=Number(await sash.getAttribute('aria-valuenow')), box=(await sash.boundingBox())!;
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:8}); await page.mouse.up();
      await expect.poll(async()=>Number(await sash.getAttribute('aria-valuenow'))).toBeGreaterThan(before+20);
    }
    await page.getByRole('button',{name:'프로젝트 검색',exact:true}).click();
    const chat=page.getByRole('region',{name:'통합 챗봇'});
    await expect(tree.getByLabel('Explorer 내용 검색')).toBeFocused();
    await tree.getByLabel('Explorer 내용 검색').fill('needle');await expect(tree.getByLabel('Explorer 검색 결과')).toContainText('hello.ts:1');
    await tree.getByRole('button',{name:'Explorer 검색 지우기'}).click();
    await chat.getByLabel('통합 챗봇 입력').fill('프로젝트에서 needle 찾아줘');
    await expect(chat).toContainText('서버 미연결'); await expect(chat.getByRole('button',{name:'보내기',exact:true})).toBeDisabled();
    await expect(chat.locator('.chat-tools')).toHaveCount(0);
    await expect(chat.getByLabel('챗봇 모델').locator('option')).toHaveText(['GPT-6.1 Sol','Astra · 서버 연결 필요']);
    for (const [shell,marker,command] of [['powershell','PS_WORKBENCH_OK',"Write-Output ('PS_' + 'WORKBENCH_OK')"],['git-bash','BASH_WORKBENCH_OK',"printf '%s%s\\n' 'BASH_' 'WORKBENCH_OK'"]] as const) {
      await page.getByLabel('셸 프로필',{exact:true}).selectOption(shell); await page.getByRole('button',{name:'터미널 시작·재시작'}).click();
      const terminal=page.getByRole('region',{name:'하단 터미널'}); await expect(terminal).toContainText('실행 중');
      // Drive the actual ConPTY through its renderer input, then observe terminal output.
      await expect(page.locator('.workspace-terminal .xterm-rows')).toContainText(shell === 'powershell' ? 'PS ' : '$ ');
      await page.locator('.workspace-terminal textarea').focus(); await page.keyboard.insertText(command); await page.keyboard.press('Enter');
      await expect(page.locator('.workspace-terminal .xterm-rows')).toContainText(marker);
      await page.getByRole('button',{name:'터미널 종료',exact:true}).click();
    }
    await page.getByRole('button',{name:'터미널 표시',exact:true}).click(); await expect(page.getByRole('region',{name:'하단 터미널'})).toBeHidden();
    await page.keyboard.press('Control+Backquote'); await expect(page.getByRole('region',{name:'하단 터미널'})).toBeVisible();
    await page.screenshot({path:'test-results/workbench-local.png'}); expect(errors).toEqual([]);
    await page.getByLabel('개인 화면 테마').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.screenshot({path:'test-results/workbench-local-dark.png'});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(720,600));
    await expect.poll(()=>page.locator('.workspace-editor').evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(80);
    await expect(page.getByRole('button',{name:'프로젝트 검색',exact:true})).toBeVisible();
    await expect(chat.getByLabel('통합 챗봇 입력')).toBeInViewport();
  } finally {
    for (const page of app.windows()) await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});
    await app.close(); await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});
  }
});

test('workbench chat streams server responses with web sources through the existing authenticated bridge', async () => {
  const fixture=await authFixture(true), profile=await mkdtemp(join(tmpdir(),'workbench-server-'));
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined && e[0]!=='ELECTRON_RUN_AS_NODE'));
  const app=await electron.launch({args:[resolve('.')],env:{...env,LOCAL_WORKSPACE_MODE:'',AUTH_SERVER_URL:fixture.url,LOCAL_AI_TEST_PROFILE:profile}});
  try {
    const page=await app.firstWindow(); await login(page,'alice',fixture.password);
    await showMode(page,'Work');
    const chat=page.getByRole('region',{name:'통합 챗봇'});
    const document=join(profile,'policy.txt');await writeFile(document,'휴가 규정은 20일입니다.');
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[file]})) as typeof dialog.showOpenDialog;},document);
    await chat.getByRole('button',{name:'개인 문서 선택·등록',exact:true}).click();
    await expect(chat).toContainText('개인 문서를 등록했습니다.');
    await chat.getByLabel('통합 챗봇 입력').fill('통합 챗 웹 검색 검증'); await chat.getByRole('button',{name:'보내기',exact:true}).click();
    await expect(chat.locator('.workbench-message.assistant')).toContainText('테스트 스트리밍 응답');
    await expect(chat.getByRole('button',{name:'공식 출처 ↗',exact:true})).toBeVisible();
    await expect(chat.locator('.workbench-message.assistant')).toContainText('[D1] policy.txt');
    await expect.poll(()=>fixture.contexts.at(-1)).toEqual(['통합 챗 웹 검색 검증']);
    await page.getByRole('button',{name:'로그아웃',exact:true}).click(); await login(page,'bob',fixture.password);
    await showMode(page,'Work');
    await expect(page.locator('.workbench-message')).toHaveCount(0);
  }finally{await app.close();await fixture.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
