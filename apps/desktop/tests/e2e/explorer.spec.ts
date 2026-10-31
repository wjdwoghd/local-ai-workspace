import { test,expect,_electron as electron } from '@playwright/test';
import { mkdtemp,mkdir,writeFile,readFile,rm,rename,unlink,stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { showMode } from './support/mode-ui';

test('Explorer watches changes, searches, edits, creates and renames items, reviews Git unstage and recycles safely',async()=>{
  test.setTimeout(150000);
  const root=await mkdtemp(join(tmpdir(),'explorer-ui-')),project=join(root,'project'),profile=join(root,'profile');
  await mkdir(join(project,'src'),{recursive:true});await mkdir(join(project,'docs'));await mkdir(join(project,'tests'));await mkdir(join(project,'constructor'));
  await writeFile(join(project,'constructor','__proto__'),'prototype filename');
  await writeFile(join(project,'src','main.py'),'value = 1\n');await writeFile(join(project,'docs','readme.md'),'# docs');
  const git=(...args:string[])=>execFileSync('git',args,{cwd:project,encoding:'utf8',windowsHide:true});
  git('init','-b','main');git('config','user.name','Explorer Test');git('config','user.email','explorer@example.invalid');git('config','core.autocrlf','false');git('add','--','src/main.py','docs/readme.md','constructor/__proto__');git('commit','-m','initial');
  await writeFile(join(project,'src','main.py'),'value = 2\n');git('add','--','src/main.py');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL','LOCAL_AI_CONNECTION_FILE'].includes(k))),packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:''}});
  try{
    const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.getByLabel('새 팀원 이름').fill('탐색기테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();await page.getByLabel('개인 화면 테마').selectOption('dark');await showMode(page,'Work');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]})) as typeof dialog.showOpenDialog;},project);
    await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
    const tree=page.getByRole('complementary',{name:'파일 탐색기'}),editor=page.getByTestId('workspace-editor');
    const folder=(name:string)=>tree.locator('.explorer-entry').filter({has:page.locator('.explorer-name').getByText(name,{exact:true})});
    const row=(path:string)=>tree.getByRole('button',{name:`${path} 작업 메뉴`,exact:true});
    const menu=page.getByRole('menu'),approval=page.getByRole('dialog',{name:'Git 작업 승인'});
    await expect(folder('src').locator('img')).toHaveAttribute('data-icon','folder-src');await folder('src').click();await expect(folder('src').locator('img')).toHaveAttribute('data-icon','folder-src-open');
    await expect(folder('docs').locator('img')).toHaveAttribute('data-icon','folder-docs');await expect(folder('tests').locator('img')).toHaveAttribute('data-icon','folder-test');
    await folder('constructor').click();await tree.getByRole('button',{name:'__proto__',exact:true}).click();await expect(editor).toContainText('prototype filename');
    await tree.getByRole('button',{name:'main.py',exact:true}).click();await expect(editor).toContainText('value = 2');
    await writeFile(join(project,'src','fresh.py'),'fresh content');await expect(tree.getByRole('button',{name:'fresh.py',exact:true})).toBeVisible({timeout:4000});
    await rename(join(project,'src','fresh.py'),join(project,'src','renamed.py'));await expect(tree.getByRole('button',{name:'renamed.py',exact:true})).toBeVisible({timeout:4000});await expect(tree.getByRole('button',{name:'fresh.py',exact:true})).toHaveCount(0);
    await unlink(join(project,'src','renamed.py'));await expect(tree.getByRole('button',{name:'renamed.py',exact:true})).toHaveCount(0,{timeout:4000});
    await writeFile(join(project,'src','main.py'),'value = 3\n');await expect(editor).toContainText('value = 3',{timeout:4000});
    // Root context prevents selected file/folder from changing the creation destination.
    await tree.locator('.explorer-toolbar strong').click({button:'right'});await menu.getByRole('menuitem',{name:'새 폴더',exact:true}).click();
    const createFolder=page.getByRole('dialog',{name:'새 폴더',exact:true});await createFolder.getByLabel('파일·폴더 이름').fill('components');await createFolder.getByRole('button',{name:'만들기',exact:true}).click();await expect(createFolder).toHaveCount(0);
    await expect(folder('components').locator('img')).toHaveAttribute('data-icon','folder-components');await folder('components').click();
    await tree.getByRole('button',{name:'새 파일',exact:true}).click();const createFile=page.getByRole('dialog',{name:'새 파일',exact:true});await createFile.getByLabel('파일·폴더 이름').fill('Widget.ts');await createFile.getByRole('button',{name:'만들기',exact:true}).click();await expect(createFile).toHaveCount(0);
    await editor.locator('textarea.inputarea').last().focus();await page.keyboard.insertText('export const answer = 42;');await page.keyboard.press('Control+s');
    await expect.poll(()=>readFile(join(project,'components','Widget.ts'),'utf8')).toBe('export const answer = 42;');
    await tree.getByRole('button',{name:'Widget.ts',exact:true}).press('F2');const renameDialog=page.getByRole('dialog',{name:'이름 변경',exact:true});await renameDialog.getByLabel('파일·폴더 이름').fill('Panel.ts');await renameDialog.getByRole('button',{name:'이름 변경',exact:true}).click();await expect(renameDialog).toHaveCount(0);await expect(page.getByRole('tab',{name:'components/Panel.ts',exact:true})).toBeVisible();
    await row('components').click();await menu.getByRole('menuitem',{name:/이름 변경/}).click();await renameDialog.getByLabel('파일·폴더 이름').fill('ui');await renameDialog.getByRole('button',{name:'이름 변경',exact:true}).click();await expect(renameDialog).toHaveCount(0);await expect(page.getByRole('tab',{name:'ui/Panel.ts',exact:true})).toBeVisible();
    expect(await readFile(join(project,'ui','Panel.ts'),'utf8')).toBe('export const answer = 42;');
    await page.keyboard.press('Control+p');await expect(tree.getByLabel('Explorer 파일 검색')).toBeFocused();await tree.getByLabel('Explorer 파일 검색').fill('panel.ts');const results=tree.getByLabel('Explorer 검색 결과');await expect(results).toContainText('ui/Panel.ts');await results.getByRole('button').click();
    await page.keyboard.press('Control+Shift+f');await expect(tree.getByLabel('Explorer 내용 검색')).toBeFocused();await tree.getByLabel('Explorer 내용 검색').fill('answer = 42');await expect(results).toContainText('ui/Panel.ts:1');await results.getByRole('button').click();
    await expect(editor).toContainText('answer = 42');
    // Explorer Git actions use the existing review and snapshot approval path.
    await expect.poll(async()=>{await row('src/main.py').click();const enabled=await menu.getByRole('menuitem',{name:/스테이징 해제 검토/}).isEnabled();if(!enabled)await page.keyboard.press('Escape');return enabled;},{timeout:15000}).toBe(true);
    const staged=git('diff','--cached');await menu.getByRole('menuitem',{name:/스테이징 해제 검토/}).click();await expect(approval).toContainText('src/main.py');expect(git('diff','--cached')).toBe(staged);await approval.getByRole('button',{name:'확인한 작업 실행'}).click();await expect(approval).toHaveCount(0);expect(git('diff','--cached')).toBe('');expect(await readFile(join(project,'src','main.py'),'utf8')).toBe('value = 3\n');
    await row('src/main.py').click();await menu.getByRole('menuitem',{name:/변경 스테이징 검토/}).click();await expect(approval).toContainText('src/main.py');await approval.getByRole('button',{name:'확인한 작업 실행'}).click();await expect(approval).toHaveCount(0);expect(git('diff','--cached')).toContain('+value = 3');
    await row('ui/Panel.ts').click();await menu.getByRole('menuitem',{name:/휴지통으로 이동/}).click();const trash=page.getByRole('dialog',{name:'휴지통으로 이동',exact:true});await trash.getByRole('button',{name:'취소',exact:true}).click();expect((await stat(join(project,'ui','Panel.ts'))).isFile()).toBe(true);
    await row('ui/Panel.ts').click();await menu.getByRole('menuitem',{name:/휴지통으로 이동/}).click();await trash.getByRole('button',{name:'휴지통으로 이동',exact:true}).click();await expect(trash).toHaveCount(0);await expect(tree.getByRole('button',{name:'Panel.ts',exact:true})).toHaveCount(0);await expect(page.getByRole('tab',{name:'ui/Panel.ts',exact:true})).toHaveCount(0);
    await page.screenshot({path:'test-results/explorer-actions.png'});expect(errors).toEqual([]);
  }finally{for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
