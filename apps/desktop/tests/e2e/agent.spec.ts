import { showMode } from './support/mode-ui';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authFixture, login } from './support/auth-server';

test('unified chat retains authenticated agent inspection, mode limits, stop and session cleanup', async () => {
  test.setTimeout(60000);
  const packaged=process.env.TEST_WORKSPACE_PACKAGED_EXE;
  const fixture=await authFixture(false,packaged?{cert:process.env.TEST_WORKSPACE_TLS_CERT!,key:process.env.TEST_WORKSPACE_TLS_KEY!}:undefined);
  const root=await mkdtemp(join(tmpdir(),'agent-e2e-')),profile=await mkdtemp(join(tmpdir(),'agent-profile-'));
  await writeFile(join(root,'a.ts'),'const value = 1;');
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined&&e[0]!=='ELECTRON_RUN_AS_NODE'));
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_AI_TEST_PROFILE:profile,AUTH_SERVER_URL:fixture.url}});
  try {
    const page=await app.firstWindow();await login(page,'alice',fixture.password);await showMode(page,'Work');
    await expect(page.locator('.chat-tools')).toHaveCount(0);await expect(page.getByLabel('통합 챗봇 입력')).toBeVisible();
    await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[root]})) as typeof dialog.showOpenDialog;},root);
    const selected=await page.evaluate(()=>window.desktop.workspace.pick());expect(selected).not.toBeNull();const id=selected!.id;
    const inspected=await page.evaluate(id=>window.desktop.agent.execute({action:'analyze',id,mode:'ask',paths:['a.ts']}),id);
    expect(inspected).toMatchObject({state:'ready',files:[{path:'a.ts'}]});
    expect(await page.evaluate(id=>window.desktop.agent.execute({action:'start',id,mode:'edit'}),id)).toMatchObject({state:'setup-required',mode:'edit'});
    expect(await page.evaluate(id=>window.desktop.agent.execute({action:'stop',id,mode:'agent'}),id)).toMatchObject({state:'interrupted'});
    await expect(page.evaluate(id=>window.desktop.agent.execute({action:'generate',id,mode:'edit',paths:['a.ts'],prompt:'change'}),id)).rejects.toThrow('로컬 API');
    expect(await readFile(join(root,'a.ts'),'utf8')).toBe('const value = 1;');
    fixture.expire();await expect(page.evaluate(id=>window.desktop.agent.execute({action:'status',id,mode:'ask'}),id)).rejects.toThrow();
    await expect(page.evaluate(id=>window.desktop.agent.execute({action:'stop',id,mode:'agent'}),id)).rejects.toThrow();
    expect(await app.evaluate(({app})=>app.isPackaged)).toBe(!!packaged);
  } finally {
    await app.close();await fixture.close();await rm(root,{recursive:true,force:true});await rm(profile,{recursive:true,force:true});
  }
});
