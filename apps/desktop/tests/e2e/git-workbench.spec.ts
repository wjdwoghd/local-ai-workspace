import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { showMode } from './support/mode-ui';

test('local Git workbench separates index/worktree, previews diffs, commits and switches branches with a live status bar and graph',async()=>{
  test.setTimeout(120000);
  const root=await mkdtemp(join(tmpdir(),'git-workbench-')),project=join(root,'project'),profile=join(root,'profile');await mkdir(project);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:project,encoding:'utf8',windowsHide:true}).trim();
  git('init','-b','main');git('config','user.name','UI Test');git('config','user.email','ui@example.invalid');git('config','core.autocrlf','false');
  await writeFile(join(project,'sample.ts'),'const count = 1;\n');git('add','--','sample.ts');git('commit','-m','initial source');git('switch','-c','feature');await writeFile(join(project,'feature.txt'),'feature branch');git('add','--','feature.txt');git('commit','-m','feature history');git('switch','main');
  await writeFile(join(project,'sample.ts'),'const count = 2;\n');git('add','--','sample.ts');await writeFile(join(project,'sample.ts'),'const count = 3;\n');await writeFile(join(project,'notes.txt'),'selected note');await writeFile(join(project,'.env'),'EMPTY=');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL','LOCAL_AI_CONNECTION_FILE'].includes(k))),packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:''}});
  try{
    const page=await app.firstWindow();
    await page.getByLabel('새 팀원 이름').fill('깃테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();await page.getByLabel('개인 화면 테마').selectOption('dark');await showMode(page,'Work');
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[project]})) as typeof dialog.showOpenDialog;},project);await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();await page.getByRole('button',{name:'소스 제어',exact:true}).click();
    const panel=page.getByRole('region',{name:'Git 소스 제어'}),bar=page.getByLabel('Git 및 작업 공간 상태');
    await expect(bar.getByRole('button',{name:'브랜치 선택',exact:true})).toContainText('main*');await expect(bar.getByRole('button',{name:'브랜치 이력',exact:true})).toContainText('initial source');
    await expect(panel.getByText('스테이징된 변경 사항',{exact:true})).toBeVisible();await expect(panel.getByText('변경 사항',{exact:true})).toBeVisible();await expect(panel).not.toContainText('gh auth login');await expect(panel.getByRole('button',{name:'.env 스테이징 검토',exact:true})).toBeDisabled();
    await panel.getByRole('button',{name:'sample.ts 작업 파일 diff',exact:true}).click();await expect(page.locator('.monaco-diff-editor')).toContainText('count = 2');await expect(page.locator('.monaco-diff-editor')).toContainText('count = 3');await page.getByRole('button',{name:'Git 비교 닫기'}).click();
    await panel.getByRole('button',{name:'sample.ts 스테이징 diff',exact:true}).click();await expect(page.locator('.monaco-diff-editor')).toContainText('count = 1');await expect(page.locator('.monaco-diff-editor')).toContainText('count = 2');await page.getByRole('button',{name:'Git 비교 닫기'}).click();
    const approval=page.getByRole('dialog',{name:'Git 작업 승인'});
    for(const path of ['notes.txt','sample.ts']){
      const before=git('diff','--cached');await panel.getByRole('button',{name:`${path} 스테이징 검토`,exact:true}).click();await expect(approval).toContainText(path);expect(git('diff','--cached')).toBe(before);await approval.getByRole('button',{name:'확인한 작업 실행'}).click();await expect(approval).toHaveCount(0);await expect(panel).toContainText('실행 완료');
    }
    await panel.getByLabel('커밋 메시지').fill('feat: selected workbench commit');await panel.getByRole('button',{name:'✓ 커밋 검토',exact:true}).click();await expect(approval).toContainText('selected workbench commit');expect(git('log','-1','--format=%s')).toBe('initial source');await approval.getByRole('button',{name:'확인한 작업 실행'}).click();await expect(approval).toHaveCount(0);
    expect(git('log','-1','--format=%s')).toBe('feat: selected workbench commit');expect(git('ls-tree','--name-only','HEAD')).not.toContain('.env');expect(await readFile(join(project,'.env'),'utf8')).toBe('EMPTY=');await expect(bar.getByRole('button',{name:'브랜치 이력',exact:true})).toContainText('selected workbench commit');
    await rm(join(project,'.env'));await panel.getByRole('button',{name:'Git 새로고침',exact:true}).click();await expect(bar.getByRole('button',{name:'브랜치 선택',exact:true})).toHaveText('⑂ main');
    await bar.getByRole('button',{name:'브랜치 선택',exact:true}).click();const branches=page.getByRole('dialog',{name:'브랜치 선택'});await branches.getByLabel('브랜치 검색 또는 새 이름').fill('feat/ui');await branches.getByRole('button',{name:/새 브랜치 만들기/}).click();await expect(approval).toContainText('feat/ui');expect(git('branch','--show-current')).toBe('main');await approval.getByRole('button',{name:'확인한 작업 실행'}).click();await expect(approval).toHaveCount(0);expect(git('branch','--show-current')).toBe('feat/ui');await expect(bar.getByRole('button',{name:'브랜치 선택',exact:true})).toContainText('feat/ui');
    await bar.getByRole('button',{name:'브랜치 선택',exact:true}).click();await branches.getByRole('button',{name:'브랜치 main',exact:true}).click();await expect(approval).toContainText('feat/ui → main');await approval.getByRole('button',{name:'확인한 작업 실행'}).click();await expect(approval).toHaveCount(0);expect(git('branch','--show-current')).toBe('main');
    await bar.getByRole('button',{name:'브랜치 이력',exact:true}).click();const history=page.getByRole('dialog',{name:'커밋 그래프와 이력'});await expect(history).toContainText('feature history');await expect(history.locator('svg circle')).toHaveCount(3);await history.getByRole('button',{name:/커밋 .* selected workbench commit/}).click();await expect(history.getByRole('button',{name:/A notes.txt/})).toBeVisible();await page.screenshot({path:'test-results/git-graph.png'});await history.getByRole('button',{name:/A notes.txt/}).click();await expect(history).toHaveCount(0);await expect(page.locator('.monaco-diff-editor')).toContainText('selected note');
    await page.screenshot({path:'test-results/git-workbench.png'});
    git('switch','feature');await expect(bar.getByRole('button',{name:'브랜치 선택',exact:true})).toHaveText('⑂ feature',{timeout:15000});await expect(bar.getByRole('button',{name:'브랜치 이력',exact:true})).toContainText('feature history');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,650));await expect(bar.getByRole('button',{name:'브랜치 선택',exact:true})).toBeInViewport();await expect(bar.getByRole('button',{name:'브랜치 이력',exact:true})).toBeInViewport();
    await expect.poll(()=>panel.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  }finally{for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
