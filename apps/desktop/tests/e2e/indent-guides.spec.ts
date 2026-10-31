import { test,expect,_electron as electron } from '@playwright/test';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { showMode } from './support/mode-ui';

test('Explorer hierarchy and Java code show nested vertical guides in light/dark editors and both diff panes',async()=>{
  test.setTimeout(90000);
  const root=await mkdtemp(join(tmpdir(),'indent-guides-')),profile=join(root,'profile'),project=join(root,'project'),folder=join(project,'src','main','java','example');
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'App.java'),'package example;\n\npublic class App {\n    public int count(int value) {\n        if (value > 0) {\n            return value + 1;\n        }\n        return 0;\n    }\n}\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL','LOCAL_AI_CONNECTION_FILE'].includes(k))),packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:''}});
  try{
    const page=await app.firstWindow();await page.getByLabel('새 팀원 이름').fill('가이드테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();await page.getByLabel('개인 화면 테마').selectOption('dark');await showMode(page,'Work');
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[project]})) as typeof dialog.showOpenDialog;},project);await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
    const tree=page.getByRole('complementary',{name:'파일 탐색기'});
    for(const name of ['src','main','java','example'])await tree.getByRole('button',{name:new RegExp(name+'$')}).click();await tree.getByRole('button',{name:'App.java',exact:true}).click();
    const treeGuides=tree.locator('li>ul'),editor=page.getByTestId('workspace-editor');await expect(treeGuides).toHaveCount(4);
    const assertTree=async()=>{const lines=await treeGuides.evaluateAll(nodes=>nodes.map(el=>({x:el.getBoundingClientRect().left,style:getComputedStyle(el).borderLeftStyle,width:getComputedStyle(el).borderLeftWidth,color:getComputedStyle(el).borderLeftColor})));expect(lines.every(l=>l.style==='solid'&&parseFloat(l.width)>0&&parseFloat(l.width)<=1&&l.color!=='rgba(0, 0, 0, 0)'),JSON.stringify(lines)).toBe(true);expect(lines.every((l,i)=>!i||l.x>lines[i-1].x)).toBe(true);return lines[0].color;};
    const darkColor=await assertTree();await expect(editor).toContainText('public class App');await expect.poll(()=>editor.locator('.core-guide.vertical').count()).toBeGreaterThan(0);
    await editor.locator('textarea').focus();await page.keyboard.press('Control+Home');for(let i=0;i<5;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
    await expect.poll(()=>editor.locator('.core-guide.indent-active').count()).toBeGreaterThan(0);
    const colors=await editor.locator('.view-lines').evaluate(e=>[...new Set([...e.querySelectorAll('span')].map(s=>getComputedStyle(s).color))]);expect(colors.length).toBeGreaterThanOrEqual(4);
    await page.screenshot({path:'test-results/indent-guides-dark.png'});
    const originalSize=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getContentSize());await page.getByRole('button',{name:'챗봇 표시',exact:true}).click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,950));
    await page.getByRole('button',{name:'저장본 비교',exact:true}).click();for(const pane of ['.editor.original','.editor.modified'])await expect.poll(()=>page.locator(pane+' .core-guide.vertical').count()).toBeGreaterThan(0);await page.getByRole('button',{name:'비교 닫기'}).click();
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size[0],size[1]),originalSize);await page.getByRole('button',{name:'챗봇 표시',exact:true}).click();
    await tree.getByRole('button',{name:/src$/}).click();await expect(treeGuides).toHaveCount(0);await tree.getByRole('button',{name:/src$/}).click();await expect(treeGuides).toHaveCount(4);
    await showMode(page,'Chat');await page.getByLabel('개인 화면 테마').selectOption('light');await showMode(page,'Work');expect(await assertTree()).not.toBe(darkColor);await expect.poll(()=>editor.locator('.core-guide.vertical').count()).toBeGreaterThan(0);await page.screenshot({path:'test-results/indent-guides-light.png'});
  }finally{for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
