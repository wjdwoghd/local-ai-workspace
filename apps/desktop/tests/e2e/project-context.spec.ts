import { test,expect,_electron as electron } from '@playwright/test';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localAPI } from '../../../server/src/local-api';
import { chatModels } from '../../../server/src/models';
import { showMode } from './support/mode-ui';

test('open folders inform AI without editor tabs; targetless code answers and failed submissions keep composer clear',async()=>{
  test.setTimeout(90000);
  const root=await mkdtemp(join(tmpdir(),'project-context-')),project=join(root,'CryptoHack'),empty=join(root,'EmptyProject'),profile=join(root,'profile'),connection=join(root,'connection.json');
  const relative='Mathmetics/Modular Math/Legendre_Symbol/solve.py',original='def existing_math():\n    return 42\n';
  await mkdir(join(project,'Mathmetics/Modular Math/Legendre_Symbol'),{recursive:true});await mkdir(empty);
  await writeFile(join(project,relative),original);await writeFile(join(project,'.env'),'SHOULD_NOT_BE_SENT=private');
  const pairing=randomBytes(32).toString('base64url'),requests:{kind:string;body:any;input:any}[]=[];
  const transport:typeof fetch=async(url,options)=>{
    if(String(url).includes('/models/'))return Response.json({id:String(url).split('/').at(-1)});
    const body=JSON.parse(options!.body as string),kind=body.text?.format?.name||'chat',input=kind==='task_plan'?JSON.parse(body.input.at(-1).content):undefined;
    requests.push({kind,body,input});
    if((input?.prompt||body.input.at(-1).content).includes('실패')){await new Promise(r=>setTimeout(r,1000));return new Response('fixture failure',{status:429});}
    const text=kind==='task_plan'?JSON.stringify({kind:input.prompt.includes('코드')?'code':'chat',query:'',mode:'edit',paths:[]}):'**프로젝트 확인 완료**\n\n```python\ndef encrypt(data):\n    return data\n```';
    return new Response([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',output:[]}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
  };
  const server=localAPI(pairing,()=>({openaiKey:'test-placeholder',models:chatModels({})}),transport);
  await server.listen({host:'127.0.0.1',port:0});const address=server.server.address();if(!address||typeof address==='string')throw new Error('listener');
  await writeFile(connection,JSON.stringify({url:`http://127.0.0.1:${address.port}`,pairing}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL'].includes(k)));
  const packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:'',LOCAL_AI_CONNECTION_FILE:connection}});
  try{
    const page=await app.firstWindow();await page.getByLabel('새 팀원 이름').fill('폴더테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();await showMode(page,'Work');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]})) as typeof dialog.showOpenDialog;},project);
    await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
    const chat=page.getByRole('region',{name:'통합 챗봇'}),input=chat.getByLabel('통합 챗봇 입력'),send=chat.getByRole('button',{name:'보내기',exact:true});
    await expect(chat.locator('.work-project-context')).toContainText('CryptoHack');await expect(chat.getByLabel('챗봇 모델')).toBeEnabled();
    await input.fill('여기 암호화 알고리즘 예제 코드 작성해봐');await input.press('Enter');await expect(input).toHaveValue('');
    await expect(chat.locator('.workbench-message.assistant pre code')).toContainText('def encrypt');await expect(chat.getByRole('alert')).toHaveCount(0);
    expect(requests.filter(r=>r.kind==='task_plan')).toHaveLength(1);
    const plan=requests.find(r=>r.kind==='task_plan')!.input;
    expect(plan.files).toEqual([relative]);expect(JSON.stringify(plan.history)).toContain('CryptoHack');expect(JSON.stringify(plan.history)).toContain('없음 (프로젝트는 열려 있음)');
    const context=JSON.stringify(requests.find(r=>r.kind==='chat')!.body.input);
    expect(context).toContain('CryptoHack');expect(context).toContain(relative);expect(context).toContain('def existing_math');expect(context).not.toContain('SHOULD_NOT_BE_SENT');
    expect(await readFile(join(project,relative),'utf8')).toBe(original);await expect(chat.locator('.work-project-context')).toContainText('1개 파일 인식');
    await expect(send).toBeDisabled();
    await input.fill('실패 요청');await input.press('Enter');await expect(input).toHaveValue('');
    await expect.poll(()=>requests.filter(r=>r.input?.prompt==='실패 요청').length).toBe(1);await input.fill('다음에 보낼 새로운 문장');
    await expect(chat.getByRole('alert')).toBeVisible();await expect(input).toHaveValue('다음에 보낼 새로운 문장');
    await chat.getByRole('button',{name:'실패한 요청 다시 입력'}).click();await expect(input).toHaveValue('실패 요청');
    await input.fill('이 프로젝트를 설명해줘');await input.press('Enter');await expect(chat.locator('.workbench-message.assistant')).toHaveCount(2);await expect(chat.locator('.workbench-message.assistant').last()).toContainText('프로젝트 확인 완료');
    expect(requests.filter(r=>r.kind==='task_plan').at(-1)!.input.history.some((h:any)=>h.text==='실패 요청')).toBe(false);
    // Replacing the folder must replace context even when no files are open.
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]})) as typeof dialog.showOpenDialog;},empty);
    await page.getByRole('button',{name:'프로젝트 전환',exact:true}).click();await expect(chat.locator('.work-project-context')).toContainText('EmptyProject');
    await expect(chat.getByLabel('챗봇 모델')).toBeEnabled();await input.fill('새 예제 코드 작성');await input.press('Enter');await expect(chat.locator('.workbench-message.assistant')).toContainText('프로젝트 확인 완료');
    const latest=JSON.stringify(requests.filter(r=>r.kind==='chat').at(-1)!.body.input);
    expect(latest).toContain('EmptyProject');expect(latest).toContain('(빈 폴더)');expect(latest).not.toContain('existing_math');
    // Main Chat uses the same clear-on-send behavior, including provider failures.
    await showMode(page,'Chat');const mainInput=page.getByLabel('메시지 입력',{exact:true});await expect(mainInput).toBeEnabled();
    await mainInput.fill('실패 메인 요청');await mainInput.press('Enter');await expect(mainInput).toHaveValue('');await mainInput.fill('새 메인 문장');
    await expect(page.locator('main>.error')).toBeVisible();await expect(mainInput).toHaveValue('새 메인 문장');
    await page.locator('main>.error').getByRole('button',{name:'실패한 요청 다시 입력'}).click();await expect(mainInput).toHaveValue('실패 메인 요청');
    await page.screenshot({path:'test-results/project-context-composer.png'});
  }finally{
    for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});
    await app.close();await server.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
