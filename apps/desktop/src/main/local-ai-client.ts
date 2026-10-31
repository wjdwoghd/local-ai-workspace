import { parseOperation, type Operation, type Result } from '../../../../packages/shared-types/auth';
import { parseChat, type ChatEvent } from '../../../../packages/shared-types/chat';
import { parseCodeOutput, type CodeInput, type CodeOutput } from '../../../../packages/shared-types/coding';
import { sse } from '../../../../packages/shared-types/sse';
import { parseTaskInput, parseTaskPlan, type TaskInput, type TaskPlan } from '../../../../packages/shared-types/task';
import { reasoningTimeout,type ReasoningEffort } from '../../../../packages/shared-types/reasoning';

export class LocalAIClient {
  async plan(raw: TaskInput): Promise<TaskPlan> {
    const input = parseTaskInput(raw), epoch = this.epoch, c = new AbortController(); this.controllers.add(c);
    try {
      const r = await this.post('/api/plan', input, c,reasoningTimeout(input.reasoningEffort)+30000);
      const result = await r.json() as { ok?: boolean; data?: unknown };
      if (epoch !== this.epoch || !r.ok || !result.ok) throw new Error('AI 작업 판단에 실패했습니다. 서버·모델 연결을 확인하세요.');
      return parseTaskPlan(result.data, input);
    } finally { this.controllers.delete(c); }
  }
  private profile: string|null=null; private token=''; private epoch=0; private pairingTask?:Promise<void>;
  private controllers=new Set<AbortController>();
  readonly url: string;
  constructor(url:string,private pairing:string,private transport:typeof fetch=fetch){
    const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^[A-Za-z0-9_-]{43}$/.test(pairing))throw new Error('로컬 API 연결 설정 오류');this.url=u.origin;
  }
  setProfile(profile:string|null){
    if(profile!==null&&!/^[a-f0-9-]{36}$/.test(profile))throw new Error('프로필 오류');
    const previous=this.token;this.cancelChat();this.epoch++;this.profile=profile;this.token='';this.pairingTask=undefined;
    if(previous)void this.transport(this.url+'/api/action',{method:'POST',headers:{Authorization:`Bearer ${previous}`,'Content-Type':'application/json'},body:JSON.stringify({action:'logout'}),signal:AbortSignal.timeout(3000),redirect:'error'}).catch(()=>{});
  }
  cancelChat(){for(const c of this.controllers)c.abort();this.controllers.clear();}
  private async ready(){
    if(!this.profile)throw new Error('프로필을 선택하세요.');if(this.token)return;
    if(!this.pairingTask){const epoch=this.epoch,profile=this.profile;
      this.pairingTask=(async()=>{const r=await this.transport(this.url+'/api/local/session',{method:'POST',headers:{Authorization:`Bearer ${this.pairing}`,'Content-Type':'application/json'},body:JSON.stringify({profile}),signal:AbortSignal.timeout(10000),redirect:'error'});const result=await r.json() as {ok?:boolean;data?:{credential?:string}};if(epoch!==this.epoch)throw new Error('프로필이 변경되었습니다.');if(!r.ok||!result.ok||!/^[A-Za-z0-9_-]{43}$/.test(result.data?.credential||''))throw new Error('서버 연결 인증 실패');this.token=result.data!.credential!;})();
    }
    const task=this.pairingTask;try{await task;}finally{if(this.pairingTask===task)this.pairingTask=undefined;}
  }
  private async post(path:string,body:unknown,controller:AbortController,timeout=150000){
    const epoch=this.epoch;await this.ready();if(epoch!==this.epoch)throw new Error('프로필이 변경되었습니다.');
    const r=await this.transport(this.url+path,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)]),redirect:'error',cache:'no-store'});
    if(epoch!==this.epoch)throw new Error('프로필이 변경되었습니다.');if(r.status===401)this.token='';return r;
  }
  async execute(raw:Operation):Promise<Result>{
    const op=parseOperation(raw),epoch=this.epoch,c=new AbortController();this.controllers.add(c);
    try{const response=await this.post('/api/action',op,c,20000);const result=await response.json() as Result;if(epoch!==this.epoch)throw new Error('Session changed');
      return response.ok&&result.ok?result:{ok:false,status:response.status,message:'로컬 API 요청 실패. 서버·모델 권한·연결을 확인하세요.'};
    }catch{return op.action==='chatStatus'?{ok:true,data:{configured:false,models:[],message:'로컬 API 서버 미연결 · 실행기를 다시 시작하세요.'}}:{ok:false,status:503,message:'로컬 API 서버에 연결할 수 없습니다.'};}finally{this.controllers.delete(c);}
  }
  async stream(raw:unknown,emit:(event:ChatEvent)=>void):Promise<Result>{
    let input;try{input=parseChat(raw);}catch{return {ok:false,status:400,message:'잘못된 채팅 요청'};}
    const epoch=this.epoch,c=new AbortController();this.controllers.add(c);
    try{const r=await this.post('/api/chat',input,c,reasoningTimeout(input.reasoningEffort)+30000);if(!r.ok||!r.body)return{ok:false,status:r.status,message:'AI 요청 실패. 서버의 키·모델·추론 수준·사용량을 확인하세요.'};
      for await(const raw of sse(r.body)){c.signal.throwIfAborted();if(epoch!==this.epoch)throw new Error('Session changed');const event=raw as ChatEvent;
        if(event.type==='delta'&&typeof event.text==='string')emit(event);else if(event.type==='sources'&&Array.isArray(event.citations)&&event.citations.length<=100)emit(event);else if(event.type==='done'){emit(event);return{ok:true,data:null};}else if(event.type==='error')return{ok:false,status:503,message:'AI 응답 중단. 키·모델 권한·사용량·네트워크를 확인하세요.'};else throw new Error('Invalid stream');}
      throw new Error('Truncated stream');
    }catch{return{ok:false,status:503,message:'요청이 중단되었습니다. 완료되지 않은 응답은 저장하지 않았습니다.'};}finally{this.controllers.delete(c);}
  }
  async code(input:CodeInput, selectedModel?: string,reasoningEffort?:ReasoningEffort):Promise<CodeOutput & {model:string}>{
    const epoch=this.epoch,c=new AbortController();this.controllers.add(c);
    try{const r=await this.post('/api/code',{...input,...(selectedModel?{model:selectedModel}:{}),...(reasoningEffort?{reasoningEffort}:{})},c,reasoningTimeout(reasoningEffort)+30000);const result=await r.json() as {ok?:boolean;data?:CodeOutput&{model:string}};
      if(epoch!==this.epoch||!r.ok||!result.ok||!result.data||typeof result.data.model!=='string')throw new Error('코딩 API 요청 실패. 키·모델·연결을 확인하세요.');
      const {model,...output}=result.data;if(selectedModel && model!==selectedModel)throw new Error('요청한 모델과 응답 모델이 다릅니다.');return{...parseCodeOutput(output,input),model};
    }finally{this.controllers.delete(c);}
  }
}
