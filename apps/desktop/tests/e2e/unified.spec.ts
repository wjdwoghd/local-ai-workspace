import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localAPI } from '../../../server/src/local-api';
import { chatModels } from '../../../server/src/models';
import { showMode } from './support/mode-ui';

test('unified prompts choose chat, search and approved edits; real terminal accepts mouse-focused input in dark compact layout', async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'unified-ui-')), profile = join(root,'profile'), project = join(root,'project'), connection = join(root,'connection.json');
  await mkdir(project); await writeFile(join(project,'a.ts'),'const a = 1; // needle');
  const pairing = randomBytes(32).toString('base64url');
  const requests: {kind:string;model:string;body:any}[] = [];
  const transport: typeof fetch = async (url, options) => {
    if(String(url).includes('/models/')) return Response.json({id:String(url).split('/').at(-1)});
    const body = JSON.parse(options!.body as string), kind = body.text?.format?.name || 'chat'; requests.push({kind,model:body.model,body});
    let text = 'mock unified answer';
    if(kind === 'task_plan') {
      const input = JSON.parse(body.input.at(-1).content);
      text = JSON.stringify(input.prompt.includes('수정') ? {kind:'code',query:'',mode:'edit',paths:['a.ts']} : input.prompt.includes('찾아') ? {kind:'files',query:'needle',mode:'ask',paths:[]} : {kind:'chat',query:'',mode:'ask',paths:[]});
    } else if(kind === 'code_proposal') text = JSON.stringify({summary:'수정 제안',changes:[{path:'a.ts',after:'const a = 2; // needle'}]});
    return new Response([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',output:kind==='chat'?[{content:[{annotations:[{type:'url_citation',title:'fixture source',url:'https://example.com',start_index:0,end_index:4}]}]}]:[]}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
  };
  const server = localAPI(pairing,()=>({openaiKey:'test-placeholder',models:chatModels({})}),transport);
  await server.listen({host:'127.0.0.1',port:0});const address=server.server.address();if(!address||typeof address==='string')throw new Error('listener');
  await writeFile(connection,JSON.stringify({url:`http://127.0.0.1:${address.port}`,pairing}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL'].includes(k)));
  const packaged = process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:'',LOCAL_AI_CONNECTION_FILE:connection}});
  try {
    const page=await app.firstWindow();await page.getByLabel('새 팀원 이름').fill('통합테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await page.getByLabel('개인 화면 테마').selectOption('dark');await showMode(page,'Work');
    const window=await app.browserWindow(page);await window.evaluate(w=>{w.unmaximize();w.setSize(900,600);});
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[project]})) as typeof dialog.showOpenDialog;},project);
    await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
    const terminal=page.getByLabel('대화형 터미널');await expect(terminal).toContainText('PS ');
    await terminal.click({position:{x:30,y:30}});await page.keyboard.type("Write-Output ('MOUSE_' + 'INPUT_OK')");await page.keyboard.press('Enter');await expect(terminal).toContainText('MOUSE_INPUT_OK');
    await showMode(page,'Chat');await showMode(page,'Work');await page.getByRole('button',{name:'터미널 표시',exact:true}).click();await page.getByRole('button',{name:'터미널 표시',exact:true}).click();
    await terminal.click({position:{x:30,y:30}});await page.keyboard.type("Write-Output ('RETURN_' + 'INPUT_OK')");await page.keyboard.press('Enter');await expect(terminal).toContainText('RETURN_INPUT_OK');
    const terminalSash=page.getByRole('separator',{name:'터미널 크기'});
    for(let i=0;i<8;i++)await terminalSash.press('ArrowDown');
    const terminalBounds=await terminal.boundingBox(),panelBounds=await page.getByRole('region',{name:'하단 터미널'}).boundingBox();
    expect(terminalBounds!.height).toBeGreaterThanOrEqual(104);expect(terminalBounds!.y+terminalBounds!.height).toBeLessThanOrEqual(panelBounds!.y+panelBounds!.height+1);
    expect(await terminal.locator('.xterm-rows').evaluate(e=>e.childElementCount)).toBeGreaterThanOrEqual(5);
    await terminal.click({position:{x:30,y:20}});await page.keyboard.type("Write-Output ('SMALL_' + 'INPUT_OK')");await page.keyboard.press('Enter');await expect(terminal).toContainText('SMALL_INPUT_OK');
    const chat=page.getByRole('region',{name:'통합 챗봇'}),picker=chat.getByLabel('챗봇 모델'),input=chat.getByLabel('통합 챗봇 입력');
    await expect(chat.locator('.chat-tools')).toHaveCount(0);await expect(picker.locator('option')).toHaveText(['GPT-6.1 Sol','Astra']);await expect(picker).toHaveValue('gpt-6.1-sol');
    await expect(input).toBeInViewport();await expect(picker).toBeInViewport();
    await input.fill('안녕');await chat.getByRole('button',{name:'보내기',exact:true}).click();await expect(chat.locator('.workbench-message.assistant').last()).toContainText('mock unified answer');await expect(picker).toBeEnabled();
    await picker.selectOption('gpt-6-astra');await input.fill('프로젝트에서 needle 찾아줘');await input.press('Enter');await expect(chat.getByLabel('프로젝트 검색 결과')).toContainText('a.ts:1');await expect(chat.locator('.workbench-message.assistant').last()).toContainText('mock unified answer');
    await expect(picker).toBeEnabled();await input.fill('a.ts를 수정해줘');await input.press('Enter');await expect(chat.locator('.agent-approval')).toContainText('a.ts');expect(await readFile(join(project,'a.ts'),'utf8')).toContain('a = 1');
    await chat.getByRole('button',{name:'이번 수정 승인',exact:true}).click();await expect.poll(()=>readFile(join(project,'a.ts'),'utf8')).toContain('a = 2');
    expect(requests.filter(r=>r.kind==='task_plan').map(r=>r.model)).toEqual(['gpt-6.1-sol','gpt-6-astra','gpt-6-astra']);
    expect(requests.find(r=>r.kind==='code_proposal')?.model).toBe('gpt-6-astra');
    expect(requests.find(r=>r.kind==='chat')?.body.tool_choice).toBe('auto');expect(requests.filter(r=>r.kind==='chat').at(-1)?.body.input.some((v:any)=>v.content.includes('줄 1'))).toBe(true);
    await page.screenshot({path:'test-results/unified-chat-terminal.png'});
  } finally {
    for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});
    await app.close();await server.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
