# 6단계 — AI 코딩 에이전트와 승인 경계

2026-10-30 (Asia/Seoul). **현재는 로컬 검사와 승인 엔진 기반 구현입니다. 실제 Codex 추론·명령 실행은 설정 필요로 차단되며, 6단계의 실제 AI 개발 완료 기준은 아직 충족하지 않습니다.** fixture를 실서비스 연결로 표시하지 않습니다.

## 실행·사용

5단계와 동일한 인증 서버 및 Oracle 설정으로 로그인한 뒤 **로컬 개발 환경 → 프로젝트 열기**를 사용합니다. 파일을 Monaco 탭으로 열고 **열린 파일 로컬 검사**를 누르면 해당 파일의 경로·UTF-8 크기·버전을 검사합니다. 프로젝트 전체를 재귀 스캔하지 않습니다. 미저장 편집이 있으면 UI에서 검사를 막고, 적용 엔진도 미저장 상태를 다시 확인합니다. 현재 AI로 전송되는 파일·터미널 출력은 없습니다.

Ask는 읽기만 허용합니다. Edit는 경로·원문/수정본 diff·기준 버전과 1회 승인 후 기존 파일 수정만 허용하는 내부 엔진을 제공합니다. Agent도 같은 승인 경계를 사용하지만 명령은 실행하지 않습니다. 실제 모델이 연결되지 않았으므로 제품에서 수정 제안을 생성하지 않으며, 승인 카드와 적용 엔진은 fixture/단위 검증 대상입니다. 모드를 바꾸면 이전 scope와 승인을 폐기합니다. 중단은 대기 승인을 무효화하고 후속 적용을 막으며, 이미 끝난 파일 변경을 자동 롤백했다고 주장하지 않습니다.

## 구조

- `packages/shared-types/agent.ts`: 모드·상태·scope·제안·승인·고정 IPC 요청 타입과 검증.
- `packages/agent-core/adapters/codex.adapter.ts`: UI와 분리된 stdio JSON line 프로토콜 어댑터. transport 주입, initialize/initialized, thread/start, turn/start, delta, turn/completed, turn/interrupt, 타임아웃·연결 종료 처리. 자식 프로세스를 생성하지 않습니다.
- `apps/desktop/src/main/agent.ts`: 인증 세대와 workspace/thread/turn에 묶인 메모리 상태, 제한된 로컬 검사, 내용 digest를 가진 2분짜리 1회 승인, 적용 직전 버전 재검사, 부분 적용 결과.
- `apps/desktop/src/renderer/AgentPanel.tsx`: 모드·범위·설정 상태·진행·diff 승인 카드·중단·결과 UI. 임의 IPC·fs·process 생성 API를 제공하지 않습니다.

모든 agent IPC는 기존 main frame/URL 검증과 고정 스키마 검증을 통과해야 합니다. `status/start/analyze/decide`는 서버 `me`로 현재 인증을 확인하고 응답 뒤 세대와 프로젝트를 다시 검사합니다. `stop`은 인증된 로컬 세션에서 서버 대기 없이 실행합니다. 로그인·로그아웃·인증 실패·프로젝트 dispose·renderer crash·창 종료 때 workspace의 기존 정리 경로에서 agent 상태를 폐기합니다. 사용자 ID를 renderer에서 입력받아 권한 판단에 사용하지 않습니다. session generation은 실제 인증 토큰 수명과 연결되며, 상태가 디스크에 저장되거나 계정 전환 때 복원되지 않습니다.

## 공식 프로토콜 확인

설치 버전: `codex-cli 0.162.0-alpha.17.2`. `codex --version`, `codex app-server --help`, `codex app-server generate-ts --out .tools/codex-stage-6-schema`를 실행했습니다. 생성된 `InitializeParams`, `ThreadStartParams`, `TurnStartParams`, `UserInput`, `AskForApproval`, 파일/명령 승인 응답 타입을 대조했습니다. 생성 산출물은 Git 제외 경로에 보관하며 전체 프로토콜을 지원한다고 주장하지 않습니다. 업그레이드 시 재생성·비교가 필요합니다.

[공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)의 초기화·thread·turn·승인 순서를 사용합니다. 어댑터는 native 파일/명령 승인 요청에 항상 decline하고, 다른 서버 도구 요청은 오류로 거부합니다. 이는 Codex 도구 전체를 LocalWorkspace 정책으로 제어할 수 있다는 의미가 아닙니다. read-only sandbox도 읽기 범위를 선택 파일로 제한한다는 보장이 없습니다. 따라서 어댑터를 제품 프로세스에 연결하지 않았습니다. 증분 delta에는 고유 이벤트 ID가 없으므로 같은 내용이라는 이유만으로 제거하지 않습니다. RPC 응답과 승인 request ID의 중복은 재실행하지 않습니다.

## 인증·모델 결정과 남은 설정

기존 Astra 챗봇 표시명·서버 모델 설정을 변경하지 않았습니다. Astra를 코딩 API 모델 ID로 가정하지 않으며 코딩 모델은 null/미확인입니다. 모델 목록은 계정 entitlement의 증거가 아니고 실제 성공한 추론이 필요합니다. 계정의 모델 목록·기존 로그인 파일·인증 토큰을 읽거나 재사용하지 않았습니다.

[공식 Codex 인증 연동 예](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)는 로컬 자식 프로세스에 OAuth access token을 주는 방식입니다. 이 저장소의 서버 전용 키 정책을 바꾸는 근거로 사용하지 않습니다. 서버 API 키를 local Codex 환경으로 전달하지 않으며, API key login IPC도 제공하지 않습니다. `apps/server/.env`는 수정하지 않았고 기존 빈 키를 유지합니다. 환경·로그·문서·설치 파일에 키를 복제하지 않습니다.

가능한 후속 구조는 서버가 인증된 사용자별로 Codex를 격리 실행하고 제한된 파일 문맥과 도구 제안만 교환하는 방식입니다. 원격 Codex는 로컬 프로젝트에 직접 접근할 수 없으므로 앱 전용 도구 브로커가 필요합니다. 서버는 검증된 모델 allowlist, 사용자/세션/thread 소유권, 요청 종류·크기·속도 제한, 도구 허용 목록을 강제해야 합니다. 다른 선택인 로컬 Codex용 Responses 중계도 같은 검증과 모델별 요청 검증이 필요하며 범용 URL/body 프록시로 만들 수 없습니다. 현재는 어느 구조도 자격 증명·모델 접근·도구 프로토콜과 함께 검증되지 않아 프록시 엔드포인트나 활성화 스위치를 추가하지 않았습니다. 모델 ID나 토큰을 입력하는 것만으로 실행이 활성화되지 않습니다.

## 파일·승인 정책

선택 프로젝트의 열린 파일 최대 20개, 파일당 256 KiB, 합계 1 MiB, 검사 루프 10초 제한입니다. 기존 UTF-8 reader의 2 MiB 상한도 적용됩니다. 디스크 IO 자체를 OS 수준에서 강제로 취소하는 10초 deadline은 아닙니다. UI 검사 결과와 감사 기록에 전체 내용을 저장하지 않습니다. 파일명 기반 기본 제외는 모든 dot 파일/폴더, secret/credential/token/password를 포함한 이름, 인증서·키 확장자와 기존 `.git/node_modules/dist/build/release/.tools` 등입니다. 일반 파일에 숨겨진 비밀 내용까지 탐지한다는 보장은 없습니다.

기존 `LocalWorkspace.path/read/save`의 절대 경로·상위 탈출·ADS·예약 장치·junction/symlink·하드 링크 거부와 파일 버전 비교를 재사용합니다. 변경 제안은 내부 어댑터 경계에서만 입력할 수 있고 renderer는 제안을 만들거나 내용을 바꿔 제출할 수 없습니다. 승인은 인증 세대(사용자 로그인 세션), workspace/thread/turn, request UUID, 경로/원문/수정본/버전의 SHA-256 digest에 연결됩니다. UI에는 diff와 버전이 보이며 만료·거절·중복·다른 scope·모드 변경 후 응답은 거부합니다. 승인 전 쓰기·명령 부작용은 없습니다. 동일 파일의 대소문자 변형 중복도 거부합니다.

적용은 파일별 순차 실행이며 각 파일 저장 직전 현재 세션·중단 여부·미저장 편집과 디스크 버전을 검사합니다. 전체 트랜잭션이 아니므로 일부 파일만 적용될 수 있고 결과에 applied/unapplied를 구분합니다. 중단과 OS rename이 겹치면 진행 중인 한 파일은 남을 수 있습니다. 세션 종료 뒤 늦은 결과는 전달하지 않습니다. 프로세스 충돌·전원 장애까지 포함한 완전한 적용 journal은 없으므로 실제 연결을 활성화하기 전에 추가 검증이 필요합니다.

생성·삭제·이름 변경·자동 되돌리기는 현재 지원하지 않습니다. 삭제된 파일은 재생성하지 않습니다. 되돌리기를 위해 git reset/clean을 호출하지 않습니다. 이후 사용자 변경을 덮어쓰는 자동 복구 기능도 제공하지 않습니다. 기존 저장의 적대적 파일시스템 교체 TOCTOU 및 Windows ACL 보존 한계는 5단계 문서와 같습니다.

## 명령·Windows 격리

[공식 Windows sandbox 문서](https://learn.chatgpt.com/docs/windows/windows-sandbox)는 제한된 사용자·접근 정책 등 실제 격리 구성을 설명합니다. 설치된 sandbox 실행 파일의 존재만으로 앱의 명령 환경이 격리되었다고 판단하지 않습니다. 현재 앱에서 선택 프로젝트 밖 쓰기·권한 상승·네트워크·파괴적 작업을 통제하는 경계가 검증되지 않았으므로 **AI 명령은 모든 모드에서 실행 불가**입니다. 명령 승인 버튼으로 안전을 보장하지 않습니다. 프로젝트 cwd는 격리가 아닙니다.

AI 실행 프로세스가 없으므로 상속할 환경·프로세스 트리·명령 출력도 없습니다. 기존 사용자 PTY를 AI 실행 경로로 사용하지 않습니다. 사용자 PTY는 기존 5단계의 OS 사용자 권한 및 환경 allowlist와 프로세스 트리 종료 정책을 그대로 사용합니다. AI 명령을 추가하려면 최소 환경, 실제 Windows sandbox 검증, 요청별 실행/인자/cwd/권한 승인, 타임아웃·출력 제한·프로세스 트리 종료·네트워크 및 외부 쓰기 테스트를 먼저 구현해야 합니다.

## 기록·범위

감사 기록은 메모리 최대 100개(action/count/time)이며 파일 내용·키·명령 전문·출력을 저장하지 않고 세션 정리 때 삭제합니다. Codex 프로세스를 시작하거나 기존 CODEX_HOME을 읽지 않아 디스크 기록·캐시·재연결을 상속하지 않습니다. 실제 연결을 추가할 때는 전용 사용자/세션 디렉터리와 전역/프로젝트 설정·MCP·skills/tools 차단, 데이터 폐기 정책을 검증해야 합니다. Git/GitHub 기능은 추가하지 않았습니다.

검증 명령과 실제/fixture 구분은 [검증 기록](agent-stage-6-validation.md)을 참고하세요.
