import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localAPI } from '../../../server/src/local-api';
import { chatModels } from '../../../server/src/models';
import { showMode } from './support/mode-ui';

test('Markdown renders with code copy and math; Chat and Work send, preview and remove actual attachments',async()=>{
  test.setTimeout(90000);
  const root=await mkdtemp(join(tmpdir(),'markdown-attachments-')),profile=join(root,'profile'),connection=join(root,'connection.json');
  const pairing=randomBytes(32).toString('base64url'),requests:any[]=[];let fail=false;
  const markdown='# 제목\n\n**굵은 글씨**와 *기울임* 및 `inline`\n\n- 첫 항목\n- 둘째 항목\n\n| 이름 | 값 |\n| --- | --- |\n| 테스트 | 42 |\n\n```javascript\nconst answer = 42;\n```\n\n\\(x^2\\)\n\n$$\ny = 2x\n$$\n\n<script>window.markdownUnsafe=true</script>\n\n[링크](https://example.com)';
  const transport:typeof fetch=async(url,options)=>{
    if(String(url).includes('/models/'))return Response.json({id:String(url).split('/').at(-1)});
    const body=JSON.parse(options!.body as string);requests.push(body);
    if(fail)return new Response('private error',{status:429});
    return new Response([{type:'response.output_text.delta',delta:markdown},{type:'response.completed',response:{status:'completed',output:[]}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
  };
  const server=localAPI(pairing,()=>({openaiKey:'test-placeholder',models:chatModels({})}),transport);
  await server.listen({host:'127.0.0.1',port:0});const address=server.server.address();if(!address||typeof address==='string')throw new Error('listener');
  await writeFile(connection,JSON.stringify({url:`http://127.0.0.1:${address.port}`,pairing}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!['ELECTRON_RUN_AS_NODE','OPENAI_API_KEY','AUTH_SERVER_URL'].includes(k)));
  const packaged=process.env.TEST_LOCAL_PACKAGED_EXE;
  const app=await electron.launch({...(packaged?{executablePath:resolve(packaged),args:[`--user-data-dir=${profile}`]}:{args:[resolve('.')]}),env:{...env,LOCAL_WORKSPACE_MODE:'1',LOCAL_AI_TEST_PROFILE:profile,LOCAL_WORKSPACE_ROSTER_FILE:'',LOCAL_AI_CONNECTION_FILE:connection}});
  try {
    const page=await app.firstWindow();await page.getByLabel('새 팀원 이름').fill('첨부테스트');await page.getByRole('button',{name:'개인 작업 공간 만들기'}).click();await page.getByRole('button',{name:'작업 공간 열기',exact:true}).click();
    const png={name:'picture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')};
    const txt={name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('첨부 문서 내용')},pdf={name:'report.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')};
    const picker=page.locator('.composer-wrap').getByLabel('파일 및 이미지 선택'),input=page.getByLabel('메시지 입력', {exact:true});
    await picker.setInputFiles([png,txt,pdf]);
    const pending=page.getByLabel('첨부 대기 파일');await expect(pending).toContainText('picture.png');
    await expect.poll(()=>pending.locator('img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(1);
    await pending.getByRole('button',{name:'picture.png 미리보기'}).click();await expect(page.getByRole('dialog',{name:'picture.png'})).toBeVisible();await page.getByRole('button',{name:'도구 닫기'}).click();
    await pending.getByRole('button',{name:'notes.txt 첨부 제거'}).click();await expect(pending).not.toContainText('notes.txt');
    await page.getByRole('button',{name:'메시지 보내기',exact:true}).click();
    const answer=page.locator('.message.assistant').last();await expect(answer.locator('strong')).toHaveText('굵은 글씨');await expect(answer.locator('table')).toContainText('테스트');await expect(answer.locator('li')).toHaveCount(2);await expect(answer.locator('.katex')).toHaveCount(2);await expect(answer.locator('.hljs-keyword')).toContainText('const');await expect(answer.locator('script')).toHaveCount(0);
    await answer.getByRole('button',{name:'코드 복사'}).click();expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('const answer = 42;\n');
    expect(await answer.locator('pre code').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('D2Coding');
    expect(await answer.locator('.hljs-keyword').evaluate(e=>getComputedStyle(e).color)).not.toBe(await answer.locator('.hljs-number').evaluate(e=>getComputedStyle(e).color));
    await page.screenshot({path:'test-results/markdown-chat.png'});
    await expect(page.getByLabel('첨부 대기 파일')).toHaveCount(0);await expect(page.getByLabel('보낸 첨부 파일')).toContainText('report.pdf');
    const sent=requests[0].input.at(-1).content;expect(sent.map((p:any)=>p.type)).toEqual(['input_text','input_image','input_file']);expect(JSON.stringify(sent)).not.toContain('notes.txt');
    await input.fill('이어서 설명해줘');await input.press('Enter');await expect(page.locator('.message.assistant')).toHaveCount(2);await expect(page.getByRole('button',{name:'메시지 보내기',exact:true})).toBeDisabled();
    expect(requests[1].input.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='input_image'))).toBe(true);
    await showMode(page,'Work');const work=page.getByRole('region',{name:'통합 챗봇'});
    await work.getByLabel('파일 및 이미지 선택').setInputFiles(txt);await work.getByLabel('챗봇 모델').selectOption('gpt-6-astra');await work.getByRole('button',{name:'보내기',exact:true}).click();
    await expect(work.locator('.workbench-message.assistant .markdown-body strong')).toHaveText('굵은 글씨');expect(requests.at(-1).model).toBe('gpt-6-astra');expect(requests.at(-1).input.at(-1).content.at(-1).text).toContain('첨부 문서 내용');
    await expect(work.getByLabel('첨부 대기 파일')).toHaveCount(0);await page.screenshot({path:'test-results/markdown-attachments.png'});
    // Pasted images and dropped documents go through the same validated uploader.
    await work.getByLabel('통합 챗봇 입력').evaluate((el,encoded)=>{
      const data=new DataTransfer(),bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));data.items.add(new File([bytes],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));
    },png.buffer.toString('base64'));
    await expect(work.getByLabel('첨부 대기 파일')).toContainText('pasted.png');
    await work.locator('form').evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['dropped notes'],'dropped.txt',{type:'text/plain'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));});
    await expect(work.getByLabel('첨부 대기 파일')).toContainText('dropped.txt');
    fail=true;await work.getByLabel('통합 챗봇 입력').fill('실패 시 보존');await work.getByRole('button',{name:'보내기',exact:true}).click();await expect(work.getByRole('alert')).toBeVisible();
    await expect(work.getByLabel('통합 챗봇 입력')).toHaveValue('');await expect(work.getByLabel('첨부 대기 파일')).toContainText('pasted.png');
    await work.getByRole('button',{name:'실패한 요청 다시 입력'}).click();await expect(work.getByLabel('통합 챗봇 입력')).toHaveValue('실패 시 보존');
    fail=false;await work.getByRole('button',{name:'보내기',exact:true}).click();await expect(work.getByLabel('첨부 대기 파일')).toHaveCount(0);
  } finally {
    for(const page of app.windows())await page.evaluate(()=>window.desktop.profiles({action:'leave'})).catch(()=>{});
    await app.close();await server.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
