import { createHash, randomUUID } from 'node:crypto';
import { AGENT_LIMITS, agentPath, type AgentApproval, type AgentChange, type AgentMode, type AgentScope, type AgentView } from '../../../../packages/shared-types/agent';
import type { LocalWorkspace } from './workspace';
import { assertApproval } from '../../../../packages/security/approvals';
import { parseCodeOutput, type CodeInput, type CodeOutput } from '../../../../packages/shared-types/coding';

const setup = 'AI 코딩은 서버 API 연결이 필요합니다. 열린 파일 전송을 확인하고 요청하세요. AI 명령 실행은 비활성화되어 있습니다.';
const digest = (scope: AgentScope, changes: AgentChange[]) => createHash('sha256').update(JSON.stringify({ scope, changes })).digest('hex');
// No process, credential, global Codex config, disk history or PTY capability is held here.
export class AgentSession {
  private epoch = 0;
  private approval?: AgentApproval;
  private scope?: AgentScope;
  private view: AgentView = this.initial('ask');
  readonly audit: { action: string; count: number; time: number }[] = [];
  constructor(private workspace: LocalWorkspace, private session: () => number) {}
  get currentScope(): AgentScope | undefined { return this.scope ? { ...this.scope } : undefined; }
  private initial(mode: AgentMode): AgentView { return { state: 'setup-required', source: 'local', model: null, authentication: 'unconfigured', mode, message: setup, files: [], applied: [], unapplied: [] }; }
  private record(action: string, count = 0) { this.audit.push({ action, count, time: Date.now() }); if (this.audit.length > 100) this.audit.shift(); }
  dispose() { this.epoch++; this.approval = undefined; this.scope = undefined; this.view = this.initial('ask'); this.audit.length = 0; }
  status(id: string, mode: AgentMode) {
    this.workspace.assertCurrent(id);
    if (this.scope && (this.scope.workspace !== id || this.scope.session !== this.session())) this.dispose();
    if (this.view.mode !== mode) { this.dispose(); this.view = this.initial(mode); }
    if (this.approval && Date.now() >= this.approval.expires) { this.approval = undefined; this.view = { ...this.view, state: 'failed', approval: undefined, message: '승인이 만료되었습니다. 새 제안이 필요합니다.' }; }
    return structuredClone(this.view);
  }
  stop(id: string, mode: AgentMode) {
    this.status(id, mode); this.epoch++; this.approval = undefined;
    this.view = { ...this.view, state: 'interrupted', approval: undefined, message: '중단했습니다. 이미 적용된 파일은 남으며 자동 롤백하지 않습니다.' }; this.record('interrupted'); return structuredClone(this.view);
  }
  start(id: string, mode: AgentMode) { this.status(id, mode); this.epoch++; this.approval = undefined; this.scope = undefined; this.view = this.initial(mode); return structuredClone(this.view); }
  async analyze(id: string, mode: AgentMode, paths: string[]) {
    this.status(id, mode); this.epoch++; const epoch = this.epoch; const session = this.session();
    this.approval = undefined; this.scope = { session, workspace: id, thread: randomUUID(), turn: randomUUID() };
    this.view = { ...this.initial(mode), state: 'analyzing' }; const started = Date.now();
    try {
      if (!paths.length || paths.length > AGENT_LIMITS.files || new Set(paths).size !== paths.length) throw new Error('파일 개수 제한');
      const files: AgentView['files'] = []; let total = 0;
      for (const path of paths) {
        agentPath(path); const file = await this.workspace.read(id, path);
        if (epoch !== this.epoch || session !== this.session()) throw new Error('만료된 분석');
        const bytes = Buffer.byteLength(file.text); total += bytes;
        if (bytes > AGENT_LIMITS.bytes || total > AGENT_LIMITS.total || Date.now() - started > AGENT_LIMITS.milliseconds) throw new Error('분석 크기·시간 한도 초과');
        files.push({ path, bytes, version: file.version });
      }
      this.view = { ...this.view, files, state: 'ready', message: `${files.length}개 파일을 로컬에서 검사했습니다. 외부 전송 없음. AI 분석에는 별도 설정이 필요합니다.` }; this.record('local-analysis', files.length);
    } catch (error) {
      if (epoch !== this.epoch || session !== this.session()) throw new Error('만료된 분석');
      this.view = { ...this.view, state: 'failed', message: error instanceof Error && !('code' in error) ? error.message : '파일 검사 실패: 경로·권한을 확인하세요.' };
    }
    return structuredClone(this.view);
  }
  async generate(id:string,mode:AgentMode,paths:string[],prompt:string,request:(input:CodeInput)=>Promise<CodeOutput & {model:string}>){
    if(this.workspace.dirty)throw new Error('저장하지 않은 편집을 먼저 저장하세요.');
    const inspected=await this.analyze(id,mode,paths);if(inspected.state!=='ready')return inspected;
    const scope={...this.scope!},epoch=this.epoch;const files:CodeInput['files']=[];
    try{
      for(const item of inspected.files){const f=await this.workspace.read(id,item.path);this.assertScope(scope);if(epoch!==this.epoch||f.version!==item.version||this.workspace.dirty)throw new Error('검사 후 파일·권한 변경');files.push({path:f.path,text:f.text,version:f.version});}
      const input={mode,prompt,files};this.view.state='running';this.view.message='서버 API로 선택한 파일을 분석 중입니다.';
      const response=await request(input);this.assertScope(scope);if(epoch!==this.epoch||this.workspace.dirty)throw new Error('중단 또는 미저장 변경');
      const {model,...raw}=response,result=parseCodeOutput(raw,input);
      this.view={...this.view,source:'api',model,authentication:'server',state:'completed',message:result.summary};
      if(result.changes.length){await this.propose(scope,result.changes.map(c=>{const f=files.find(f=>f.path===c.path)!;return{path:c.path,before:f.text,after:c.after,version:f.version};}));this.view.message=result.summary+'\n변경 내용을 확인하고 승인하세요.';}
      return structuredClone(this.view);
    }catch(e){if(epoch!==this.epoch||scope.session!==this.session())throw new Error('중단되거나 이전 프로필의 요청입니다.');this.view={...this.view,state:'failed',message:e instanceof Error&&!('code'in e)?e.message:'AI 코딩 요청 실패. 파일은 변경하지 않았습니다.'};return structuredClone(this.view);}
  }
  // Internal adapter boundary only. Renderer cannot inject proposals or change their content.
  async propose(scope: AgentScope, changes: AgentChange[]) {
    const epoch = this.epoch;
    this.assertScope(scope);
    if (this.view.mode === 'ask' || this.workspace.dirty || !changes.length || changes.length > AGENT_LIMITS.files) throw new Error('모드 제한 또는 저장하지 않은 편집 내용');
    if (new Set(changes.map(c => c.path.toLowerCase())).size !== changes.length) throw new Error('중복 파일');
    let total = 0;
    for (const c of changes) {
      agentPath(c.path); total += Buffer.byteLength(c.after);
      if (Buffer.byteLength(c.after) > AGENT_LIMITS.bytes || total > AGENT_LIMITS.total) throw new Error('제안 크기 한도');
      const disk = await this.workspace.read(scope.workspace, c.path); this.assertScope(scope);
      if (epoch !== this.epoch || this.workspace.dirty) throw new Error('작업 권한이 변경되었습니다.');
      if (disk.version !== c.version || disk.text !== c.before) throw new Error('외부 변경 충돌');
    }
    const copy = structuredClone(changes);
    this.approval = { id: randomUUID(), scope: { ...scope }, changes: copy, expires: Date.now() + AGENT_LIMITS.approvalMs, digest: digest(scope, copy) };
    this.view = { ...this.view, state: 'approval', approval: this.approval, message: '경로·기준 버전·변경 내용을 확인한 뒤 1회 승인하세요.' };
    this.record('proposal', copy.length); return this.status(scope.workspace, this.view.mode);
  }
  private assertScope(scope: AgentScope) {
    this.workspace.assertCurrent(scope.workspace);
    if (!this.scope || JSON.stringify(scope) !== JSON.stringify(this.scope) || scope.session !== this.session()) throw new Error('만료되었거나 다른 세션의 작업');
  }
  async decide(id: string, mode: AgentMode, approval: string, contentDigest: string, accept: boolean) {
    this.status(id, mode); const p = this.approval;
    assertApproval(p, approval, contentDigest);
    this.assertScope(p.scope); this.approval = undefined; this.view.approval = undefined;
    if (!accept) { this.view = { ...this.view, state: 'completed', message: '거절했습니다. 파일 변경 없음.' }; this.record('declined'); return structuredClone(this.view); }
    const epoch = this.epoch; this.view = { ...this.view, state: 'running', applied: [], unapplied: p.changes.map(c => c.path) };
    try {
      if (mode === 'ask' || this.workspace.dirty || digest(p.scope, p.changes) !== contentDigest) throw new Error('권한·미저장 편집 충돌');
      for (const c of p.changes) {
        this.assertScope(p.scope);
        if (epoch !== this.epoch || this.workspace.dirty) throw new Error('작업 중단 또는 편집 충돌');
        const check = () => { this.assertScope(p.scope); if (epoch !== this.epoch || this.workspace.dirty) throw new Error('작업 중단 또는 편집 충돌'); };
        const result = await this.workspace.save(id, c.path, c.after, c.version, false, check);
        check();
        if (result.conflict) throw new Error('외부 변경 충돌: 새 제안과 승인이 필요합니다.');
        this.view.applied.push(c.path); this.view.unapplied = this.view.unapplied.filter(path => path !== c.path);
      }
      this.view.state = 'completed'; this.view.message = '승인한 수정 적용 완료. 명령 실행은 비활성화되어 테스트를 실행하지 않았습니다.'; this.record('applied', this.view.applied.length);
    } catch {
      if (epoch !== this.epoch || this.session() !== p.scope.session) throw new Error('만료된 작업 결과는 폐기했습니다. 이미 적용된 파일은 남을 수 있습니다.');
      this.view.state = 'failed'; this.view.message = '적용 중 중단·충돌·실패. 적용/미적용 목록을 확인하세요. 자동 롤백 없음.'; this.record('apply-failed', this.view.applied.length);
    }
    return structuredClone(this.view);
  }
}
