import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { showMode } from './support/mode-ui';

test('DB-free profiles: personal folders, theme/log isolation, unsaved guard, cross-project refusal and restart', async () => {
  test.setTimeout(120000);
  const root=await mkdtemp(join(tmpdir(),'local-profile-ui-')); const profile=join(root,'app');const roster=join(root,'roster.json');
  await writeFile(roster,JSON.stringify(['홍길동','김테스트']));
  let requests=0;const trap=createServer((_req,res)=>{requests++;res.writeHead(503).end();});
  await new Promise<void>(r=>trap.listen(0,'127.0.0.1',r));
  const port=(trap.address() as AddressInfo).port;
  const env={...Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined && e[0]!=='ELECTRON_RUN_AS_NODE')),LOCAL_WORKSPACE_MODE:'1',LOCAL_WORKSPACE_ROSTER_FILE:roster,LOCAL_AI_TEST_PROFILE:profile,AUTH_SERVER_URL:`http://127.0.0.1:${port}`};
  const packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const launch=()=>test.step('launch isolated Electron profile',()=>electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env,timeout:30000}));
  let app:ElectronApplication|undefined;
  const close=async()=>{if(app){
    // Release workspace resources before quitting. Destroying all windows first
    // races Electron's automatic quit against Playwright's app.close().
    for(const page of app.windows()) await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});
    await app.close();app=undefined;
  }};
  try{
    app=await launch();let page=await app.firstWindow();
    await expect(page.getByRole('heading',{name:'팀원 작업 공간 선택'})).toBeVisible();
    expect((await page.evaluate(()=>window.desktop.profiles({action:'list'}))).profiles).toHaveLength(2);
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await page.getByLabel('팀원 이름',{exact:true}).selectOption({label:'홍길동'});await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await expect(page.locator('.session-bar')).toContainText('홍길동');await page.getByLabel('개인 화면 테마').selectOption('dark');
    await showMode(page,'Work');await page.getByRole('button',{name:'내 작업 폴더 열기'}).click();
    await expect(page.locator('.workspace-toolbar small')).toBeVisible();const homeA=(await page.locator('.workspace-toolbar small').textContent())!;
    await writeFile(join(homeA,'personal.txt'),'profile A saved');
    execFileSync('git',['init','-b','main'],{cwd:homeA,windowsHide:true});
    await page.getByRole('button',{name:'소스 제어',exact:true}).click();
    await page.getByRole('button',{name:'Git 새로고침'}).click();
    await page.locator('.git-panel').getByRole('button',{name:'personal.txt 스테이징 검토',exact:true}).click();
    await page.getByRole('dialog',{name:'Git 작업 승인'}).getByRole('button',{name:'확인한 작업 실행'}).click();
    await expect(page.locator('.git-panel')).toContainText('실행 완료');
    await page.getByRole('button',{name:'탐색기',exact:true}).click();
    await page.getByRole('complementary',{name:'파일 탐색기'}).getByRole('button',{name:'personal.txt',exact:true}).click();
    const editor=page.getByTestId('workspace-editor').locator('textarea.inputarea').last();await editor.focus();await page.keyboard.press('Control+A');await page.keyboard.insertText('unsaved A');
    await page.getByRole('button',{name:'프로필 전환',exact:true}).click();await page.getByRole('dialog',{name:'저장하지 않은 변경'}).getByRole('button',{name:'취소',exact:true}).click();
    await expect(page.locator('.session-bar')).toContainText('홍길동');
    await page.getByRole('button',{name:'프로필 전환',exact:true}).click();await page.getByRole('dialog',{name:'저장하지 않은 변경'}).getByRole('button',{name:'폐기',exact:true}).click();
    await page.getByLabel('팀원 이름',{exact:true}).selectOption({label:'김테스트'});await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await expect(page.getByLabel('개인 화면 테마')).toHaveValue('system');
    const logs=await page.evaluate(()=>window.desktop.auth({action:'activity'}));expect(logs).toEqual({ok:true,data:[]});
    await showMode(page,'Work');await page.getByRole('button',{name:'내 작업 폴더 열기'}).click();const homeB=(await page.locator('.workspace-toolbar small').textContent())!;expect(homeB).not.toBe(homeA);
    await expect(page.getByRole('complementary',{name:'파일 탐색기'})).not.toContainText('personal.txt');
    await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[root]})) as typeof dialog.showOpenDialog;},homeA);
    await page.getByRole('button',{name:'프로젝트 전환',exact:true}).click();await expect(page.locator('.workspace-notice')).toContainText('다른 프로필');
    const before=await page.evaluate(()=>window.desktop.workspace.home());await page.evaluate(()=>window.desktop.profiles({action:'leave'}));
    await expect(page.evaluate(id=>window.desktop.workspace.list(id,''),before.id)).rejects.toThrow();
    expect(await readFile(join(homeA,'personal.txt'),'utf8')).toBe('profile A saved');
    await close();app=await launch();page=await app.firstWindow();
    await page.getByLabel('팀원 이름',{exact:true}).selectOption({label:'홍길동'});await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await expect(page.getByLabel('개인 화면 테마')).toHaveValue('dark');
    expect(await page.evaluate(()=>window.desktop.auth({action:'activity'}))).toMatchObject({ok:true,data:[{action:'git.stage',outcome:'succeeded'},{action:'git.stage',outcome:'started'}]});
    await showMode(page,'Work');await page.getByRole('button',{name:'내 작업 폴더 열기'}).click();await expect(page.locator('.workspace-toolbar small')).toHaveText(homeA);
    expect(requests).toBe(0);
  }finally{await close();await new Promise<void>(r=>trap.close(()=>r()));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
