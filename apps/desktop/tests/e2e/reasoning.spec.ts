import { test,expect,_electron as electron,type ElectronApplication } from '@playwright/test';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { localAPI } from '../../../server/src/local-api';
import { chatModels } from '../../../server/src/models';
import { showMode } from './support/mode-ui';
test('Sol and Astra levels reach chat, planning and approved edits; Ultra runs reviewers; preferences survive model/profile switches and restart',async()=>{
  test.setTimeout(90000);
  const root=await mkdtemp(join(tmpdir(),'reasoning-ui-')),profile=join(root,'profile'),project=join(root,'project'),connection=join(root,'connection.json'),roster=join(root,'roster.json');
  await mkdir(project);await writeFile(join(project,'a.ts'),'const a = 1;');await writeFile(roster,JSON.stringify(['level-one','level-two']));
  const pairing=randomBytes(32).toString('base64url'),requests:{body:any;kind:string;worker:boolean}[]=[];
  const transport:typeof fetch=async(url,options)=>{
    if(String(url).includes('/models/'))return Response.json({id:String(url).split('/').at(-1)});
    const body=JSON.parse(options!.body as string),kind=body.text?.format?.name||'chat',worker=body.instructions.startsWith('병렬 검토자');requests.push({body,kind,worker});
    const text=worker?'독립 검토 완료':kind==='task_plan'?JSON.stringify({kind:'code',query:'',mode:'edit',paths:['a.ts']}):kind==='code_proposal'?JSON.stringify({summary:'수준 반영 수정',changes:[{path:'a.ts',after:'const a = 2;'}]}):'최종 종합 답변';
    return new Response([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
  };
  const server=localAPI(pairing,()=>({openaiKey:'test-placeholder',models:chatModels({})}),transport);
  await server.listen({host:'127.0.0.1',port:0});const address=server.server.address();if(!address||typeof address==='string')throw Error('listener');await writeFile(connection,JSON.stringify({url:`http://127.0.0.1:${address.port}`,pairing}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL'].includes(k))),packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const launch=()=>electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:roster,LOCAL_AI_CONNECTION_FILE:connection}});
  let app:ElectronApplication|undefined;
  const close=async()=>{if(app){for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});await app.close();app=undefined;}};
  try{
    app=await launch();let page=await app.firstWindow();await page.getByLabel('팀원 이름',{exact:true}).selectOption({label:'level-one'});await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    const main=page.getByRole('region',{name:'채팅 화면'}),effort=main.getByLabel('추론 수준'),input=main.getByLabel('메시지 입력',{exact:true});
    await expect(effort.locator('option')).toHaveText(['Light','Medium','High','Extra High','Max','Ultra']);await expect(effort).toHaveValue('medium');
    await effort.selectOption('low');await input.fill('빠른 질문');await input.press('Enter');await expect(main.locator('.message.assistant')).toContainText('최종 종합 답변');expect(requests[0].body.reasoning.effort).toBe('low');
    await expect(effort).toBeEnabled();await effort.selectOption('ultra');const before=requests.length;await input.fill('복잡한 비교');await input.press('Enter');await expect(main.locator('.message.assistant')).toHaveCount(2);await expect(main.locator('.message.assistant').last()).toContainText('최종 종합 답변');
    const parallel=requests.slice(before);expect(parallel).toHaveLength(4);expect(parallel.filter(r=>r.worker)).toHaveLength(3);expect(parallel.every(r=>r.body.model==='gpt-6.1-sol'&&r.body.reasoning.effort==='max')).toBe(true);await expect(main).not.toContainText('독립 검토 완료');
    await showMode(page,'Work');await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[project]})) as typeof dialog.showOpenDialog;},project);await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
    await expect(page.locator('.workspace-toolbar>strong')).toHaveText('project');
    const work=page.getByRole('region',{name:'통합 챗봇'}),workEffort=work.getByLabel('추론 수준'),model=work.getByLabel('챗봇 모델');
    await expect(workEffort).toHaveValue('ultra');await model.selectOption('gpt-6-astra');await expect(workEffort).toHaveValue('medium');await workEffort.selectOption('xhigh');await work.getByLabel('통합 챗봇 입력').fill('a.ts를 수정해줘');await work.getByLabel('통합 챗봇 입력').press('Enter');
    await expect(work.locator('.agent-approval')).toContainText('a.ts');expect(await readFile(join(project,'a.ts'),'utf8')).toBe('const a = 1;');
    for(const kind of ['task_plan','code_proposal'])expect(requests.find(r=>r.kind===kind)!.body,kind).toMatchObject({model:'gpt-6-astra',reasoning:{effort:'xhigh'}});
    await work.getByRole('button',{name:'이번 수정 승인',exact:true}).click();await expect.poll(()=>readFile(join(project,'a.ts'),'utf8')).toBe('const a = 2;');
    await expect(workEffort).toBeEnabled();await workEffort.selectOption('max');await model.selectOption('gpt-6.1-sol');await expect(workEffort).toHaveValue('ultra');await model.selectOption('gpt-6-astra');await expect(workEffort).toHaveValue('max');
    await page.getByRole('button',{name:'프로필 전환',exact:true}).click();await page.getByLabel('팀원 이름',{exact:true}).selectOption({label:'level-two'});await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();await expect(page.getByRole('region',{name:'채팅 화면'}).getByLabel('추론 수준')).toHaveValue('medium');
    await close();app=await launch();page=await app.firstWindow();await page.getByLabel('팀원 이름',{exact:true}).selectOption({label:'level-one'});await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    await expect(page.getByRole('region',{name:'채팅 화면'}).getByLabel('추론 수준')).toHaveValue('ultra');await page.getByRole('region',{name:'채팅 화면'}).getByLabel('모델 선택').selectOption('gpt-6-astra');await expect(page.getByRole('region',{name:'채팅 화면'}).getByLabel('추론 수준')).toHaveValue('max');
    await page.screenshot({path:'test-results/reasoning-levels.png'});
  }finally{await close();await server.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
