import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { showMode } from './support/mode-ui';

test('bundled D2Coding renders editor, both diff panes and terminal with distinct syntax colors',async()=>{
  test.setTimeout(90000);
  const root=await mkdtemp(join(tmpdir(),'code-style-')),profile=join(root,'profile'),project=join(root,'project');await mkdir(project);
  await writeFile(join(project,'sample.ts'),'// 한글 주석\nconst greeting: string = "D2Coding 한글";\nconst count = 42;\n');
  await writeFile(join(project,'sample.ps1'),'# 한글 주석\n$number = 42\nWrite-Output "hello"\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','LOCAL_AI_CONNECTION_FILE','AUTH_SERVER_URL'].includes(k)));
  const packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:''}});
  try{
    const page=await app.firstWindow();await page.getByLabel('새 팀원 이름').fill('글꼴테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await page.getByLabel('개인 화면 테마').selectOption('dark');await showMode(page,'Work');
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[project]})) as typeof dialog.showOpenDialog;},project);
    await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();const tree=page.getByRole('complementary',{name:'파일 탐색기'});await tree.getByRole('button',{name:'sample.ts',exact:true}).click();
    const editor=page.getByTestId('workspace-editor');await expect(editor).toContainText('D2Coding 한글');
    expect(await page.evaluate(()=>[...document.fonts].filter(f=>f.family==='D2Coding'&&f.status==='loaded').length)).toBe(2);
    await expect.poll(()=>editor.locator('.view-lines').first().evaluate(e=>getComputedStyle(e).fontFamily)).toContain('D2Coding');
    const tokenColors=()=>editor.locator('.view-lines').first().evaluate(e=>[...new Set([...e.querySelectorAll('span')].filter(s=>s.textContent?.trim()).map(s=>getComputedStyle(s).color))]);
    await expect.poll(async()=>(await tokenColors()).length).toBeGreaterThanOrEqual(4);
    const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const doc=await cdp.send('DOM.getDocument'),node=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.workspace-editor .view-lines .view-line span[class^="mtk"]'});
    const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});expect(fonts.fonts.some((f:any)=>f.isCustomFont&&f.familyName.includes('D2Coding')),JSON.stringify(fonts.fonts)).toBe(true);
    await page.getByRole('button',{name:'저장본 비교',exact:true}).click();await expect(page.locator('.monaco-diff-editor')).toBeVisible();
    for(const pane of ['.editor.original .view-lines','.editor.modified .view-lines'])await expect.poll(()=>page.locator(pane).evaluate(e=>getComputedStyle(e).fontFamily)).toContain('D2Coding');
    await page.getByRole('button',{name:'비교 닫기'}).click();await tree.getByRole('button',{name:'sample.ps1',exact:true}).click();await expect.poll(async()=>(await tokenColors()).length).toBeGreaterThanOrEqual(3);
    const terminal=page.getByLabel('대화형 터미널');await expect(terminal).toContainText('PS ');await terminal.click({position:{x:30,y:25}});
    await page.keyboard.type('Write-Output -InputObject "D2Coding 한글"; $example = 42');
    await expect(terminal).toContainText('$example');
    await expect.poll(()=>terminal.locator('.xterm-rows').evaluate(e=>[...new Set([...e.querySelectorAll('span')].filter(s=>s.textContent?.trim()).map(s=>getComputedStyle(s).color))].length)).toBeGreaterThanOrEqual(4);
    expect(await terminal.locator('.xterm-rows').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('D2Coding');
    await page.screenshot({path:'test-results/d2coding-dark.png'});await page.keyboard.press('Enter');await expect(terminal).toContainText('D2Coding 한글');
    await showMode(page,'Chat');await page.getByLabel('개인 화면 테마').selectOption('light');await showMode(page,'Work');await expect.poll(async()=>(await tokenColors()).length).toBeGreaterThanOrEqual(3);
    await page.screenshot({path:'test-results/d2coding-light.png'});
  }finally{for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
