# DB 없는 로컬 서버와 실제 OpenAI API 연결

VS Code 형태의 작업 공간은 그대로 유지한다. 별도 Codex 앱이나 Codex App Server를 연결하지 않는다. 챗·웹 검색·코딩 도우미는 `apps/server`의 로컬 API 서버를 통해 OpenAI Responses API를 사용한다. Oracle·SQLite 등 DB 연결은 생성하지 않는다.

## 현재 계정 상태 — 2026-10-30

사용자 요청으로 기본 모델을 **GPT-6.1 Sol (`gpt-6.1-sol`)**로 변경했다. 채팅과 Work 챗봇의 모델 목록은 **GPT-6.1 Sol·Astra 두 개만** 기본 제공한다. 모델 목록과 기본값은 서버가 관리하며, 선택한 모델 ID를 그대로 Responses API에 전달한다. 실패 시 다른 모델로 자동 대체하지 않는다.

이전 계정 확인에서 Astra 조회는 404였다. 변경 후 `/v1/models/gpt-6.1-sol`은 200과 일치하는 모델 ID를 반환해 Sol 접근 권한을 확인했다. 실제 유료 응답 생성은 실행하지 않았다. 기본 모델의 접근 권한은 **연결 새로고침**으로 확인하며, 각 전송 직전에도 선택한 모델의 권한을 확인한다. 로컬 코딩 도우미는 서버 기본 모델을 사용한다. 서버는 `.env`를 요청마다 다시 읽는다. 서버 코드 변경 후에는 빌드하고 재시작해야 한다.

검증: 타입 검사, 서버 단위 테스트 47개, 서버·데스크톱 빌드, Electron UI 테스트 통과. UI 테스트는 두 모델만 표시되는지, Sol 기본 선택, Sol 채팅 요청과 Astra 웹 검색 요청의 정확한 모델 ID 전달을 모의 API로 확인했다.

## 실행과 설정

이 PC에서는 `.tools/Start-Team-App.cmd` 또는 `.tools/Start-Team-App.ps1`을 실행한다. 이미 실행 중인 로컬 서버를 인증해 확인하고, 없으면 Node 서버만 숨김 창으로 시작한 후 포터블 앱을 연다. Oracle·기존 DB·TLS 프록시는 시작하지 않는다. 서버는 기본 `127.0.0.1:3002`에서만 수신한다.

다른 개발 환경에서 수동 실행할 때는 먼저 비밀값 없는 `apps/server/.env.example`을 복사하고 키를 서버 파일에만 입력한다. 실제 모델 ID와 표시명 설정은 다음과 같다. API 키는 이 문서에 기재하지 않는다.

```dotenv
OPENAI_MODEL_ID=gpt-6.1-sol
OPENAI_MODEL_LABEL=GPT-6.1 Sol
OPENAI_ASTRA_MODEL_ID=gpt-6-astra
OPENAI_ADDITIONAL_MODELS=[]
```

첫 번째 PowerShell:

```powershell
pnpm build
$env:LOCAL_AI_CONNECTION_FILE = 'C:\local-ai-workspace\.tools\local-ai-server.json'
pnpm --filter @local-ai-workspace/server start:local
```

두 번째 PowerShell:

```powershell
$env:LOCAL_WORKSPACE_MODE = '1'
$env:LOCAL_AI_CONNECTION_FILE = 'C:\local-ai-workspace\.tools\local-ai-server.json'
pnpm dev
```

`LOCAL_AI_ENV_FILE`로 서버 `.env`의 절대 경로를 지정할 수 있다. 기본값은 서버 작업 디렉터리의 `.env`다. `LOCAL_AI_PORT`로 루프백 포트를 바꿀 수 있다. 연결 파일은 서버가 실제 수신 주소와 임시 pairing 자격 증명만 기록한다. OpenAI 키는 포함하지 않는다. 이 파일·로그·설치 파일은 Git에서 제외한다. 이 PC 실행기는 데스크톱을 시작하기 전에 `OPENAI_API_KEY` 환경 변수를 제거한다.

## 인증·데이터 분리

데스크톱 메인 프로세스만 연결 파일을 읽는다. 로컬 HTTP는 `127.0.0.1`의 이 전용 API에 한정한다. 기존 원격 인증 서버의 HTTPS 규칙은 유지한다. 서버는 브라우저 Origin 요청을 거부하고 pairing bearer 인증 후 프로필 UUID에 묶인 개별 만료 세션을 발급한다. renderer에는 API 키·pairing 값·서버 세션 토큰을 노출하지 않는다. API 외부 요청은 공식 `https://api.openai.com/v1` 경로로만 보낸다.

대화 조회·변경·생성 요청과 스트림은 매번 현재 서버 세션과 대화 소유자를 확인한다. 프로필 전환 시 요청을 취소하고 이전 서버 세션을 폐기한다. 다른 프로필의 conversation ID는 404로 거부한다. 진행 중인 API 결과가 늦게 도착해도 이전 프로젝트·모드·세션이면 적용하지 않는다. 서버 요청 로그는 비활성화하며 공급자 오류 본문·키·토큰을 응답이나 로그로 전달하지 않는다.

Windows에서는 pairing 파일을 비운 상태에서 현재 서버 사용자·SYSTEM·관리자 ACL을 적용한 후 임시 자격 증명을 기록한다. 이 PC의 실제 서버 `.env`도 소유자인 개발 실행 계정·EZ·SYSTEM·관리자만 접근하도록 보호했다. 일반 Users/Authenticated Users의 접근은 제거했다. 서버를 재시작해 pairing이 바뀌면 앱도 실행기로 다시 연다.

현재 로컬 서버의 대화와 실제 토큰 사용량 기록은 메모리에만 보관한다. 앱 재실행 중에도 같은 서버 프로세스가 살아 있으면 API의 대화 목록·메시지를 조회할 수 있으나, 새 챗 패널은 새 대화를 시작한다. **서버를 종료하면 대화·사용량은 사라진다.** 개인 프로젝트 파일·테마·Git 기록의 기존 JSON 저장은 유지한다. 사용자 이름 선택은 같은 Windows 계정의 논리적 프로필 구분이며 OS 계정 인증은 아니다. 이 로컬 서버를 LAN에 공개하거나 다른 PC에서 원격으로 연결하도록 구현하지 않는다.

## 실제 API 경로

- 챗: 서버가 정확한 모델 접근 권한을 먼저 조회한 후 `store:false`, 스트리밍 Responses 요청을 실행한다. 현재 대화의 완료된 이력만 전달한다. 오류·중단된 응답은 완료된 대화에 저장하지 않는다.
- 웹 검색: 같은 API 요청의 `web_search` 도구와 실제 반환된 URL citation을 사용한다. 모의 출처를 제품에 만들지 않는다.
- 코딩: 사용자 요청과 명시적으로 전송을 확인한 열린 파일 저장본을 서버로 보낸다. Responses의 JSON Schema 출력으로 설명과 기존 선택 파일의 전체 수정안만 받는다. Ask는 수정안을 거부한다. Edit/Agent 수정은 기존 workspace/세션/버전/digest/만료 승인에 묶고 Diff를 확인한 사용자 승인 후만 적용한다. 새로운 파일·삭제·임의 경로·명령 실행은 이 경로에서 제공하지 않는다.
- 파일 검색: 현재 프로젝트에서 로컬 검색한다. 이 DB 없는 API 서버는 Oracle의 등록 문서·팀 공유·관리자 기능을 제공하지 않는다. 기존 원격 서버 모드의 문서 기능은 보존했다.

반환된 실제 usage만 현재 프로필에 기록하며 수집되지 않은 값이나 비용을 만들어 채우지 않는다. 코딩 요청은 성공하더라도 자동 명령·테스트 실행을 했다고 표시하지 않는다.

공식 근거: [OpenAI Docs 모델 안내](https://developers.openai.com/api/docs/guides/latest-model), [웹 검색](https://developers.openai.com/api/docs/guides/tools-web-search), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). 공식 문서의 모델 명세와 해당 계정의 실제 접근 권한은 구분한다.

## 검증

서버 단위 테스트는 pairing·Origin·세션·소유자 검사, 빈 키·Astra 접근 거부·대체 금지, 스트림 완료 저장·중단 보존·실제 usage만 기록, JSON Schema 코딩 제안과 선택 외 파일/Ask 수정 거부, 세션 폐기를 검증한다. 데스크톱 테스트는 실제 파일의 API 제안을 승인 전 보존하고 승인 후 적용하는지, 중단 후 늦은 결과와 잘못된 파일을 거부하는지 확인한다.

`local-api.spec.ts`는 격리된 실제 HTTP 서버와 Electron 사이의 pairing·프로필 세션·챗/웹 스트림·출처·코딩 Diff 승인·다른 프로필 접근 거부를 확인한다. OpenAI 응답은 이 자동 테스트에서 명시적인 mock이다. 운영 키를 테스트에 포함하거나 테스트를 실제 API 성공으로 보고하지 않는다.

최종 검증 결과: 타입 검사·서버/데스크톱 빌드·diff 검사 통과, 단위 테스트 109개(서버 45개, 데스크톱 64개) 통과. 전체 개발 E2E는 13개 통과 및 EXE 환경 변수용 2개 건너뜀이며, 이후 최종 패키지 경로를 지정해 API·프로필·workbench·패키지·포터블을 추가 검증했다. 최종 패키지의 실제 서버 상태 표시와 pairing 파일의 보호 ACL도 확인했다. asar main 코드가 빌드와 일치하고, 실제 API 키 값·`.env`·실제 명단·pairing 설정 파일은 포함되지 않았다. Windows 설치형·포터블 EXE를 갱신했으며 설치 마법사 재설치·코드 서명은 수행하지 않았다.
