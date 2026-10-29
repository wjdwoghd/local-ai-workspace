# 7단계 Git/GitHub 및 팀 협업

## 선행 상태와 구현 범위

시작 시 브랜치는 `feat/stage-1-electron-ui`, 사용자 미커밋 변경은 `AGENTS.md`뿐이었다. 이를 보존하고 브랜치를 전환하지 않았다. 이번 개발 저장소의 커밋·push·PR은 실행하지 않는다. 테스트가 생성하는 임시 저장소의 커밋과 구분한다.

1단계 Electron/React UI, 2단계 Oracle 세션·역할 및 소유권 검사, 3단계 설정 기반 Responses 채팅, 4단계 팀 구성원 문서 ACL, 5단계 작업공간·Monaco·사용자 직접 PTY, 6단계 로컬 분석·수정 승인 엔진이 존재한다. **6단계의 실제 Codex 인증 중계·AI 명령 실행·sandbox는 비활성**이며 완료로 간주하지 않는다. 이번 Git 기능은 AI 명령 실행을 활성화하지 않는다. Astra 모델 설정과 서버 API 키를 변경하지 않는다.

재사용: 신뢰된 renderer의 좁은 IPC, `AuthClient`의 메모리 세션 및 generation, `LocalWorkspace`의 폴더 선택·경로 검사·수명 주기, 터미널의 환경 변수 allowlist, 기존 에이전트와 공통화한 승인 ID/digest/만료 검사. 기존 PTY에는 구조화된 명령 승인 API가 없어 Git 전용 인자 allowlist 실행기를 추가했다. renderer가 실행 파일·명령 문자열·cwd를 지정할 수 없다.

## 실행 및 설정

Node 24 및 pnpm을 준비하고 저장소 루트에서 다음을 실행한다. 기존 인증 서버의 Oracle·HTTPS·세션 설정이 필요하다. 값은 로컬에서 입력하고 채팅·로그에 출력하지 않는다.

```powershell
pnpm install
pnpm --filter @local-ai-workspace/server db:migrate
pnpm dev:server
pnpm dev
```

기존 001~003 이후 `004_collaboration.sql`을 순서대로 적용하며 schema version은 4다. 서버는 version 4가 아니면 시작을 거부한다. 팀은 기존 관리자 화면에서 생성하고 구성원을 등록한다. 기존 문서는 유지된다. 새 기록·사용량은 수집 시작 이후부터 저장하며 과거 값을 추정하지 않는다.

Git for Windows와 GitHub CLI를 프로젝트 밖에 설치하고 PATH에 등록한다. 각 팀원은 **별도 Windows 계정**에서 다음 로그인 절차를 수행한다.

```powershell
gh auth login --web --hostname github.com --git-protocol https
gh auth setup-git --hostname github.com
```

브라우저 로그인과 OS credential store는 GitHub CLI가 관리한다. 앱에 토큰 입력·반환·로그 출력 API가 없다. API 키와 `GH_TOKEN` 등 임의 환경 변수를 자식 프로세스에 상속하지 않는다. 기본 gh 설정 파일에서 평문 `oauth_token`을 발견하면 연결을 거부한다. `--insecure-storage`는 사용하지 않는다. credential store 실패 시 gh의 평문 fallback을 제거하고 OS 저장소를 복구한 후 로그인해야 한다. 앱은 gh 설정을 삭제하거나 인증 토큰을 직접 다루지 않는다.

공식 근거: [gh auth login](https://cli.github.com/manual/gh_auth_login), [gh auth setup-git](https://cli.github.com/manual/gh_auth_setup-git), [gh pr create](https://cli.github.com/manual/gh_pr_create), [git push](https://git-scm.com/docs/git-push), [git pull](https://git-scm.com/docs/git-pull), [OpenAI Responses usage](https://developers.openai.com/api/reference/resources/responses/methods/create).

## 사용자 흐름

- 로그인 → 로컬 개발 환경 → 저장소 루트 폴더 선택 → Git / GitHub 패널 펼치기. status, 현재/로컬 브랜치 목록, HEAD, origin, GitHub 계정, 파일별 index/worktree 상태가 표시된다.
- 파일별 diff 확인 → 체크한 파일만 스테이징/해제 검토 → 경로·변경 확인 → 1회 승인. 커밋은 현재 스테이징 **전체**를 표시하고 승인받는다. 의도하지 않은 기존 스테이징을 포함하지 않도록 먼저 해제한다.
- push/pull/PR 검토에서는 HTTPS `origin`과 현재 GitHub 계정·브랜치를 확인한다. 비교용 fetch가 객체와 FETCH_HEAD만 갱신한다. 대상 커밋과 전체 비교 diff를 보여준 뒤 실행 승인한다. 원격이 바뀌면 다시 검토해야 한다.
- push는 명시적 `HEAD:refs/heads/<현재 브랜치>` 하나만 전송한다. 강제 push·태그 자동 전송·mirror를 사용하지 않는다. pull은 깨끗한 작업공간에서 fetch + `merge --ff-only`만 사용한다. 분기된 이력/기존 충돌은 수동 해결을 안내하고 자동 stash/복원/충돌 선택을 하지 않는다.
- PR은 제목·설명·base를 검토하고 draft로 만든다. 명시적 `--head`와 repo를 사용해 암묵적 push/fork를 방지한다. 먼저 원격 branch HEAD가 로컬 HEAD와 같아야 한다. 생성 URL만 검증해 반환한다. base 브랜치를 병합하지 않는다.
- 웹·파일 검색 → 자신이 소유한 문서의 공유 범위 변경 → 소속 팀 또는 개인 선택 → 변경. 다른 구성원은 읽기·검색만 가능하며 문서 소유자만 공유 변경·삭제가 가능하다. 관리자도 타인의 비공개 문서에 접근할 수 없다. 원본·대상 팀 소속을 재검사하고 관련 membership 행을 잠근다. 팀에서 제외된 소유자도 팀 문서를 조회·공유 해제할 수 없다. 재가입 등 관리 절차가 필요하다.
- 팀 협업·사용량 메뉴에서 개인 기록과 실제 수집 토큰을 확인한다. 관리자에게는 자신이 속한 팀의 **현재 구성원** 사용량 합계만 제공한다. 개인 대화 내용·개별 사용량 목록을 팀 집계에 포함하지 않는다. 팀 구성원 변경에 따라 집계 대상이 달라지며, 과거 팀 소속 당시 사용량 통계가 아니다.

## 보안 및 기록

Git 명령은 shell 없이 고정된 인자 배열로 실행한다. 현재 프로젝트 밖의 절대 경로 Git/gh 실행 파일을 찾고 상대 PATH 및 프로젝트 내 실행 파일을 거부한다. 저장소 루트의 실제 `.git` 디렉터리만 지원하며 외부 gitdir/worktree, 링크, pathspec/옵션 주입, URL 자격 증명·재작성, 비 HTTPS GitHub 원격은 거부한다. Git hook과 검증은 우회하지 않는다. **신뢰할 수 있는 저장소만 열어야 한다.** hook·필터·credential helper는 OS 사용자 권한으로 실행되며 AI sandbox에 격리되지 않는다.

승인은 2분 만료·1회 사용이며 세션/작업공간/HEAD/index/diff/설정/선택 파일 버전을 묶는다. 승인 후 변경되면 재검토한다. 거절·로그아웃·프로젝트 종료는 대기 승인을 폐기하며 진행 중 Git/gh 프로세스에 중단을 요청한다. 이미 원격에 반영된 동작은 되돌리지 않는다. 원격 세션 폐기는 기존 5초 인증 모니터링까지 지연될 수 있다. OS에서 동시에 실행하는 Git이나 적대적 파일 변경에 대한 완전한 원자성·자식 hook 프로세스 트리의 강제 격리는 보장하지 않는다.

`.env`, 인증 파일, 빌드·설치·로그 경로를 차단한다. 비밀값이 없는 `.env.example`은 허용한다. 알려진 토큰·개인키·일부 키 대입 패턴과 바이너리·크기 제한을 스테이징 및 커밋 시 검사한다. 외부에서 이미 스테이징한 내용도 커밋 전에 검사한다. 보호된 경로도 내용을 표시하거나 읽지 않고 스테이징만 해제할 수 있다. push/PR은 삭제된 비밀값을 놓치지 않도록 HEAD에서 도달하는 이력 전체를 검사한다. 보수적 제한은 최대 1000 객체·파일 2MiB·blob 합계 10MiB이며 초과 시 차단한다. 큰 저장소, 바이너리 자산, 알려지지 않은 비밀 형식은 별도 보안 검토가 필요하다. 이 휴리스틱이 모든 비밀정보·개인정보 탐지를 보장하지 않는다.

서버의 모든 협업 연산은 `withUser`를 거쳐 사용자 ID를 결정한다. 공유 변경과 문서 업로드·삭제 기록은 동일 Oracle transaction에 저장한다. Git 실행 전 `started`, 이후 `succeeded`/`failed`를 저장한다. 시작 기록이 저장되지 않으면 실행하지 않는다. 실행 후 서버가 끊기면 기록이 불완전할 수 있으며 새로고침하여 실제 결과를 확인해야 한다. Git 기록은 인증된 데스크톱의 보고이며 원격 작업 완료를 증명하는 변조 불가능한 감사 로그가 아니다. 문서 내용·로컬 경로·Git 메시지·원격 출력·토큰은 기록하지 않는다.

토큰 사용량은 서버가 받은 `response.completed.response.usage`의 유효한 입력/출력/합계만 run별 1회 저장한다. 클라이언트 사용량 입력 API가 없다. 수집 후 대화 저장이 실패해도 이미 저장된 사용량을 남긴다. usage 누락·불일치, 중단·미완료 응답, 권한 취소·네트워크 장애로 수집되지 않은 사용량과 다른 앱 사용량은 추정하지 않는다. 기록이 없으면 토큰 수는 null(확인 불가), 비용은 항상 null이다. 이 수집값은 OpenAI 청구서 전체와 같지 않다.

## 검증

실행한 검증과 미검증 외부 환경은 [검증 결과](collaboration-stage-7-validation.md)를 참조한다. 실제 팀 운영 완료를 확정하려면 Oracle migration/동시성 및 GitHub OS credential store·실계정 push/pull/PR 검증이 필요하다.
