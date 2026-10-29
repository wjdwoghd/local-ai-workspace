# 2단계: Oracle 및 계정 인증

1단계 채팅·사이드바·설정·테마 UI 위에 로그인을 적용합니다. 실제 AI 연결은 없고 Astra는 표시명입니다. 대화 **제목만** Oracle에 저장하며 데모 메시지는 메모리에서만 유지합니다. 메시지 저장·컨텍스트·실제 모델 ID 확인은 3단계입니다. 팀 문서와 GitHub는 아직 연결하지 않습니다.

## 사전 준비와 환경 변수

Node.js 24 LTS, pnpm 10.34.5, Oracle 19c 이상(Thin 연결 가능), AL32UTF8 데이터베이스를 사용합니다. Oracle Client 설치가 필요 없는 node-oracledb Thin 모드를 사용합니다. Oracle 계정·접속 주소와 세션 비밀값은 서버에만 둡니다.

```powershell
pnpm install --frozen-lockfile
# 기존 .env가 있으면 덮어쓰지 말고 .env.example의 누락 항목만 수동으로 추가합니다.
if (!(Test-Path apps/server/.env)) { Copy-Item apps/server/.env.example apps/server/.env }
```

`apps/server/.env` 설정:

| 변수 | 의미 |
| --- | --- |
| ORACLE_USER / ORACLE_PASSWORD | 전용 애플리케이션 스키마와 비밀번호 |
| ORACLE_CONNECT_STRING | DBA가 제공한 Easy Connect 주소, 예: 호스트:1521/서비스명 |
| SESSION_SECRET | 암호학적 난수 32바이트 이상. 모든 서버 인스턴스에서 동일하게 사용 |
| SESSION_MINUTES | 절대 세션 수명 1~1440분, 기본 480분, 자동 연장 없음 |
| HOST / PORT | 기본 127.0.0.1 / 3001 |
| NODE_ENV | 개발 development, 운영 production |
| HTTPS_PROXY_CONFIRMED | 운영에서 TLS 프록시를 실제 구성한 뒤 true |
| OPENAI_API_KEY | 현재 공란 유지. 이 단계에서는 읽거나 호출하지 않음 |

SESSION_SECRET은 비밀번호 관리 도구로 만들거나 서버에서 `node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"`로 생성해 서버 설정에만 저장합니다. 출력된 실제 값은 채팅·Git·문서·로그에 붙이지 않습니다. 변경하면 기존 세션이 모두 무효화됩니다. `.env`는 모든 위치에서 Git 제외 대상이며 기존 사용자 설정은 수정하지 않았습니다.

## Oracle 스키마와 마이그레이션

DBA가 운영 애플리케이션용 빈 스키마와 전용 테이블스페이스 할당량을 준비합니다. SYS/SYSTEM 계정으로 앱을 실행하지 않습니다. 필요한 권한은 `CREATE SESSION`, 마이그레이션 시 `CREATE TABLE`이며 자기 테이블의 인덱스를 생성할 수 있어야 합니다. 테이블스페이스에는 DBA가 적절한 quota를 부여합니다. 계정 비밀번호는 DBA의 비밀 관리 절차를 사용하고 SQL 파일에 넣지 않습니다.

```powershell
pnpm --filter @local-ai-workspace/server db:migrate
```

`database/oracle/migrations/001_auth.sql`이 기준입니다. 기존 `database/oracle/schema` 파일은 후속 단계를 위한 scaffold이며 이 단계 마이그레이션에 포함되지 않습니다. 모든 테이블은 `s2_` 접두사로 구분합니다. 마이그레이션은 서버를 중단한 상태에서 운영자 한 명만 실행합니다. SQL을 CLI가 문장 단위로 실행하며 `s2_control.version=1`로 기록합니다. 완료 후 재실행은 아무 작업도 하지 않습니다. Oracle DDL은 자동 commit이므로 중간 실패를 전체 rollback할 수 없습니다. 실패 시 서버는 버전 검사로 시작을 거부합니다. 원인을 해결한 뒤 같은 명령으로 재개할 수 있으며 이미 생성된 같은 이름의 테이블·인덱스를 건너뜁니다. 다른 용도의 `s2_*` 객체가 있는 스키마에서 실행하지 말고, 중단 후에는 DBA가 객체 정의를 원본 SQL과 확인합니다. 운영 변경 전 백업은 DBA 절차를 따릅니다.

| 테이블 | 소유권 및 용도 |
| --- | --- |
| s2_users | 소문자 정규화 계정 이름, scrypt 해시, admin/user, 활성 상태 |
| s2_sessions | HMAC-SHA256 토큰 해시, 사용자 FK, UTC 만료 시각 |
| s2_settings | 사용자 FK가 PK, 개인 테마 |
| s2_conversations | UUID, 사용자 FK, 개인 제목; 관리자 우회 조회 없음 |
| s2_login_limits | HMAC 처리한 IP/계정별 시도 수와 15분 창 |
| s2_control | 버전 및 초기 관리자·관리 작업 직렬화 잠금 |

서버 전용 풀은 최소 1, 최대 10개 연결을 사용합니다. 시작 시 연결 확인과 버전 검사를 수행하고 실패하면 종료합니다. 매 요청은 commit/rollback/finally close 경로를 거칩니다. SQL 값은 모두 바인딩합니다. SIGINT/SIGTERM 시 HTTP 요청 처리를 종료한 뒤 풀을 정리합니다. Oracle 오류 내용과 접속 문자열은 클라이언트나 기본 로그에 출력하지 않습니다. DB 장애 시 대체 DB로 전환하지 않습니다.

## 초기 관리자와 팀원 계정

공개 회원가입 API는 없습니다. 사용자 테이블이 비어 있을 때만 서버 CLI로 최초 관리자를 생성할 수 있습니다. 동시 실행은 DB 제어 행 잠금으로 차단합니다. 고정 초기 비밀번호는 없습니다.

```powershell
$env:BOOTSTRAP_USERNAME = Read-Host '초기 관리자 계정 이름 (영문·숫자·._-, 3~64자)'
$bootstrapSecure = Read-Host '초기 관리자 비밀번호 (12~128자)' -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $bootstrapSecure).Password
try { pnpm --filter @local-ai-workspace/server admin:bootstrap }
finally {
    Remove-Item Env:BOOTSTRAP_USERNAME,Env:BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    $bootstrapSecure.Dispose()
}
```

실제 비밀번호는 셸 명령에 직접 입력하거나 `.env.example`에 넣지 않습니다. 비밀번호는 16바이트 랜덤 salt를 갖는 scrypt(N=32768, r=8, p=3, 64바이트 결과)로 저장하고 일정 시간 비교를 사용합니다. 서버 로그에는 이벤트명·UTC 시각만 기록합니다.

관리자로 로그인 → 상단 **계정 관리** → 팀원 계정 생성 → 별도 보안 경로로 비밀번호 전달. 일반 사용자 10명을 각각 생성할 수 있습니다. 관리자도 추가 생성할 수 있습니다. 비활성화와 비밀번호 초기화는 대상의 모든 세션을 같은 트랜잭션에서 폐기합니다. 초기화해도 비활성 계정은 활성화되지 않습니다. 재활성화 UI는 이번 범위에 없습니다. 자기 계정의 비활성화·관리자에 의한 자기 비밀번호 초기화는 거부하므로 마지막 활성 관리자를 UI로 없앨 수 없습니다. 운영 전 보조 관리자를 준비하세요. 관리자 계정 복구는 DBA/운영자 절차가 필요하며 공개 복구 API는 없습니다.

## 서버·데스크톱 실행

서로 다른 터미널에서 실행합니다. 서버 명령은 pnpm filter로 실행해야 `.env`와 마이그레이션의 상대 경로가 맞습니다.

```powershell
pnpm dev:server
```

```powershell
# 데스크톱에 주는 유일한 연결 설정: 공개 서버 URL. DB/API/세션 비밀값은 전달하지 않습니다.
$env:AUTH_SERVER_URL = 'http://127.0.0.1:3001'
pnpm dev
```

개발에서만 정확한 127.0.0.1 HTTP를 허용합니다. 패키징된 앱에는 `AUTH_SERVER_URL=https://...`를 실행 환경으로 제공해야 합니다. 운영 배포는 서버 환경을 `NODE_ENV=production`, `HTTPS_PROXY_CONFIRMED=true`로 설정하고 신뢰되는 인증서를 쓰는 TLS 프록시를 배치합니다. [nginx 설정 예시](../../apps/server/deploy/nginx.conf.example)를 실제 도메인·인증서 경로로 수정하고, Node 포트는 루프백에만 열고 방화벽으로 외부 접근을 차단합니다. 인증서 검증을 해제하지 않습니다. `.env`, DB 접속 설정, API 키는 Electron `dist` 또는 설치 파일에 포함하지 않습니다. Electron 빌드는 `dist`와 desktop package.json만 패키징합니다.

빌드 후 서버 실행은 `pnpm --filter @local-ai-workspace/server start`입니다. 데스크톱 빌드·패키징 명령은 기존 `pnpm build`, `pnpm package:win`을 유지합니다. 이전 1단계 실행 파일은 이번 변경이 반영된 산출물이 아니므로 새로 빌드해야 합니다. 패키지/포터블 smoke test는 HTTPS `AUTH_SERVER_URL`을 지정해야 하며 로그인 화면 시작을 검사합니다. 이 단계에서는 설치 파일을 새로 제작하지 않았습니다.

## 세션 전달, 권한, 캐시

Electron 메인 프로세스가 HTTP를 중개합니다. 256비트 랜덤 bearer 토큰은 **메인 메모리에만** 두고 렌더러·preload 응답·localStorage·sessionStorage·디스크에 전달하지 않습니다. 서버는 토큰 원문 대신 SESSION_SECRET으로 만든 HMAC만 저장합니다. 로그인 응답에서 메인이 토큰을 제거한 뒤 사용자 공개 정보만 렌더러에 보냅니다. 앱 재실행 후 자동 로그인하지 않으며 다른 계정으로 로그인하기 전 기존 세션을 폐기합니다. 앱 강제 종료 시 서버 세션은 만료까지 남지만 클라이언트에는 복구할 자격증명이 없습니다.

렌더러 IPC는 `getInfo`, `setTheme`, 허용 목록을 엄격히 검증하는 `auth`만 노출합니다. 임의 URL·헤더·사용자 ID·SQL을 받지 않습니다. 기존 WebContents·최상위 프레임·정확한 URL·인수 개수 검사, sandbox/contextIsolation, Node 비활성화, 네트워크 CSP를 유지합니다. 서버 URL의 자격증명·경로·쿼리·fragment를 거부하고 HTTP 리디렉션을 따라가지 않습니다.

서버의 단일 `POST /api/action`은 로그인 외의 **모든** 작업에서 세션·활성 계정·만료를 검사합니다. 관리 작업은 admin 역할을 추가 확인합니다. 개인 데이터의 조회·생성·수정·삭제는 인증된 세션의 사용자만 사용하며 다른 사용자 ID 필드는 400으로 거부합니다. 다른 사용자 UUID와 존재하지 않는 UUID 모두 404입니다. 관리자도 개인 대화 권한을 얻지 않습니다. 자기 설정 API에는 사용자 ID나 타인 설정 ID 자체가 없습니다.

사용자 행을 잠근 뒤 세션을 다시 확인하여 비활성화·초기화·로그아웃과 보호 작업을 직렬화합니다. 이미 처리 중인 요청은 폐기 작업보다 먼저 완료될 수 있지만, 폐기 commit 이후 기존 세션의 새 요청은 거부합니다. 관리 작업은 제어 행을 먼저 잠가 관리자 상호 관리의 교착을 방지합니다.

로그아웃 즉시 워크스페이스 컴포넌트를 제거하고 입력·메시지·대화 목록·설정·관리자 목록을 폐기합니다. 다음 계정은 별도 컴포넌트에서 서버 데이터를 새로 읽습니다. 인증 오류 401 시 같은 처리를 수행하고, 15초마다 및 창 focus 시 만료·폐기를 확인합니다. 서버 응답에는 `Cache-Control: no-store`를 붙입니다. DB 장애 등 503은 인증 오류와 구별합니다. 로그아웃 중 네트워크 장애가 발생하면 로컬 자격증명은 제거하지만 서버 폐기는 확인할 수 없어 UI에 안내합니다. 이 경우 관리자 비활성화/비밀번호 초기화 또는 세션 만료가 서버 측 폐기를 보장합니다.

1단계 기기 공용 `settings.json`은 읽거나 덮어쓰지 않습니다. 로그인 후 테마는 Oracle의 개인 설정에서 불러옵니다. 데모 메시지는 서버 저장 대상이 아니어서 로그아웃·만료·종료 후 복원되지 않으며 제목만 복원됩니다.

로그인은 계정당 15분에 10회, 서버가 인식한 IP당 100회로 제한합니다(성공 포함). 제한 상태도 DB에 저장해 서버 재시작으로 우회하지 못하게 합니다. 알 수 없는 계정도 같은 scrypt 비용으로 검증하며 잘못된 비밀번호·없는 계정·비활성 계정의 응답은 같습니다. 프록시 헤더를 신뢰하지 않으므로 TLS 프록시 뒤에서는 같은 프록시 IP의 제한을 공유합니다. 기본 100회는 팀원 10명 첫 로그인에 충분하지만 빈번한 재로그인 시 15분 대기가 필요할 수 있습니다. 외부 프록시에서도 접속 제한을 적용하세요. 운영자는 주기적으로 만료된 `s2_sessions`와 `reset_at`이 지난 `s2_login_limits` 행을 삭제할 수 있으며, 실행 중 잠금 경합이 적은 시간에 수행합니다. 로그에는 비밀번호·계정 이름·본문·자격증명·DB 예외를 남기지 않습니다.

## 검증 실행

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:oracle
```

단위 테스트는 해시·검증·구성·요청 검증·에러 은닉·트랜잭션·Electron 세션 중개를 검사합니다. Electron E2E는 명시적인 테스트용 HTTP fixture로 실제 창의 로그인·로그아웃·계정 전환·캐시 제거·관리자 화면·인증 만료·연결 실패·데모 채팅·테마 복원·보안 설정을 확인합니다. 이 fixture는 `tests/e2e/support`에만 있고 운영 서버나 앱에 모의 DB 대체 경로가 없습니다. E2E 통과는 실제 Oracle 인증 검증을 대신하지 않습니다.

실제 Oracle 통합 테스트는 별도 DB 사용자로 준비한 **전용 빈** `LAW_TEST_*` 스키마에서만 실행합니다. 운영 ORACLE_USER와 같으면 접속 전에 거부합니다. 다음 항목을 서버 `.env`에 추가합니다.

```dotenv
TEST_ORACLE_USER=
TEST_ORACLE_PASSWORD=
TEST_ORACLE_CONNECT_STRING=
TEST_ORACLE_CONFIRM_SCHEMA=
```

`TEST_ORACLE_USER`는 예를 들어 `LAW_TEST_AUTH`처럼 대문자 LAW_TEST_ 접두사가 있어야 하며 `TEST_ORACLE_CONFIRM_SCHEMA`에 정확히 같은 이름을 입력합니다. 접속 후 SESSION_USER도 대조하고 기존 사용자 데이터가 있으면 테스트를 거부합니다. 테스트가 마이그레이션을 적용하고 랜덤 비밀번호로 관리자·10명을 생성합니다. 운영 자격증명을 복사하지 않습니다. 테스트는 자신이 생성한 UUID·랜덤 관리자 이름·해당 제한 키만 finally에서 삭제하며 DROP/TRUNCATE를 실행하지 않습니다. 테이블은 재실행을 위해 남습니다. 강제 종료로 행이 남으면 전용 테스트 스키마임을 확인한 운영자가 정리해야 합니다.

검사 항목: 10명 로그인 및 개인 설정·목록, 타 사용자와 관리자에 의한 타인 대화 조회/수정/삭제 404, 소유자 CRUD, 일반 사용자의 모든 관리 작업 403, 위조 owner 필드 400, 로그아웃·UTC 만료·비활성화·비밀번호 초기화 후 세션 401, 잘못된 로그인·11번째 시도 429, 초기 관리자 중복 생성 차단, 트랜잭션 rollback. TEST_ORACLE_USER가 없으면 통합 테스트는 명시적으로 skip합니다. 접속 변수가 일부만 있거나 잘못되면 테스트가 실패하며 모의 DB로 대체하지 않습니다.

공식 구현 참고: [Oracle 연결 풀](https://node-oracledb.readthedocs.io/en/latest/user_guide/connection_handling.html), [트랜잭션 및 DDL commit 동작](https://node-oracledb.readthedocs.io/en/latest/user_guide/txn_management.html), [Node.js scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
