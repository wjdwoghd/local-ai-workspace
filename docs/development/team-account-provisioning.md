# 팀 계정 일괄 생성

> 현재 이 PC는 사용자 요청에 따라 [DB 없는 로컬 작업 공간](local-workspaces.md)으로 전환했다. 아래 Oracle 계정 생성/실행 절차는 이전 서버 모드 기록이다. 앱 전용 PDB는 삭제하지 않고 닫았으며, 현재 실행기는 서버와 Oracle을 사용하지 않는다.

서버 전용 운영자 CLI로 일반 사용자 계정을 최대 10명까지 한 트랜잭션에 생성한다. 이름은 한글·영문·숫자·._-를 지원하며 NFC/영문 소문자로 정규화하고 Oracle username 열에 맞춰 UTF-8 64바이트로 제한한다.

실제 명단과 초기 비밀번호는 Git에 포함하지 않는다. JSON 배열 형태의 명단은 로컬 Git 제외 디렉터리 또는 저장소 밖에 보관하고, 비밀번호는 실행 시 로컬에서 입력한다. 이 명령의 초기 비밀번호만 명시적으로 4~128자를 허용한다. 일반 관리자 화면의 신규/초기화 비밀번호 정책(12~128자)은 유지한다. 공통의 짧은 비밀번호는 서로의 계정으로 로그인할 수 있으므로 개인별 비밀번호로 전환해야 한다. 현재 사용자 본인의 비밀번호 변경 UI는 없으며 관리자가 초기화할 수 있다.

사전 조건은 `apps/server/.env`에 실제 Oracle 접속 및 SESSION_SECRET 설정, 마이그레이션 version 4 적용이다. API 키 없이 계정·로그인을 사용할 수 있다. 명단 파일에 비밀번호를 넣지 않는다. 예시 명단은 `["홍길동", "김테스트"]` 같은 이름 배열이며 실제 팀 명단은 운영자가 로컬에서 준비한다.

```powershell
$env:TEAM_ACCOUNTS_FILE = Read-Host '명단 JSON 파일의 절대 경로'
$teamInitialSecure = Read-Host '공통 초기 비밀번호' -AsSecureString
$env:TEAM_INITIAL_PASSWORD = [System.Net.NetworkCredential]::new('', $teamInitialSecure).Password
try { pnpm --filter @local-ai-workspace/server users:provision }
finally {
    Remove-Item Env:TEAM_ACCOUNTS_FILE,Env:TEAM_INITIAL_PASSWORD -ErrorAction SilentlyContinue
    $teamInitialSecure.Dispose()
}
```

계정마다 무작위 salt로 scrypt 해시를 생성한다. 기존 이름이 하나라도 있으면 생성 전체를 중단하며 기존 계정의 비밀번호·권한·활성 상태를 바꾸지 않는다. 관리자 권한은 부여하지 않는다. 이 CLI는 HTTP나 renderer에서 호출할 수 없으며 서버 DB 설정에 접근 가능한 운영자가 실행한다. 출력은 완료 이벤트와 생성 수만 포함한다.

한글 로그인을 사용하려면 서버와 Electron 앱 양쪽에 최신 입력 검증 코드가 반영돼 있어야 한다. 이전 설치 파일은 한글 아이디를 거부한다. 실제 DB 삽입·전체 로그인 확인 전에는 계정 생성 완료로 보고하지 않는다.

## 2026-10-30 로컬 구성 및 검증

사용자의 별도 DB 생성 요청에 따라 기존 `FREEPDB1`을 유지하고, `LOCALAI_TEAM` PDB와 최소 권한(`CREATE SESSION`, `CREATE TABLE`)의 `LAW_APP` 스키마를 만들었다. 서버 자격 증명·세션 비밀값은 로컬에서 무작위 생성했으며 앱 계정 비밀번호와 별개다. 서버 `.env` 및 운영자 전용 Git 제외 파일에만 저장하고 설치 파일에 포함하지 않는다. 실제 명단과 초기 비밀번호는 이 문서에 기록하지 않는다.

최신 마이그레이션 version 4 적용 후 10명을 일반 사용자로 생성했다. 실제 Oracle 인증으로 10명 로그인과 순환 방식 타인 대화 10건 접근 거부, 서로 다른 salt 해시 10개를 확인했다. 패키징된 실제 Electron 앱에서도 10명 로그인·로그아웃, 타인 대화 9건 접근 거부, API 사용량 미수집 상태(null)를 확인했다. 검증 중 만든 임시 격리 대화는 제거했으며 앱 첫 로그인 시 생성한 빈 기본 대화는 각 사용자에게 유지한다.

실제 Oracle 적용에서 발견한 `004_collaboration.sql`의 ORA-02438은 열 수준 CHECK의 타 열 참조를 테이블 수준 제약조건으로 옮겨 수정했다. 새 스키마에서 기존 객체를 삭제하지 않고 마이그레이션을 재개해 완료했다.

이 PC의 로컬 실행기는 Git 제외 `.tools/Start-Team-App.cmd`이다. 인증 서버는 `127.0.0.1:3001`, 로컬 TLS 프록시는 `127.0.0.1:3443`에만 바인딩한다. 프록시 소스는 `apps/server/src/local-proxy.ts`이며 환경 변수 `LOCAL_TLS_CERT_FILE`, `LOCAL_TLS_KEY_FILE`로 인증서·키를 읽는다. `.tools/team-local-tls`에 별도 로컬 인증서를 생성했으며 시스템 신뢰 저장소를 변경하지 않았다. 앱 프로세스에만 `NODE_EXTRA_CA_CERTS`와 공개 `AUTH_SERVER_URL`을 전달한다. 서버 API/DB 키를 데스크톱에 전달하지 않는다.

이는 이 PC의 개발·확인 구성이다. 다른 팀원 PC에서 사용하려면 공용 HTTPS 인증 서버 주소와 신뢰할 수 있는 인증서를 별도로 구성해야 한다. 현재 구성은 LAN에 공개하지 않으며 서버 자동 시작을 Windows 서비스로 등록하지 않았다. 별도 앱 관리자 계정은 임의로 생성하거나 팀원에게 관리자 역할을 부여하지 않았다.

최종 타입 검사·서버/데스크톱 빌드와 단위 테스트 92개(서버 37, 데스크톱 55)가 통과했다. 실제 PDB 조회에서 기존/신규 PDB 모두 READ WRITE, schema version 4, 활성 사용자 10명·서로 다른 해시 10개, `S7_USAGE_TOTAL` 제약조건 ENABLED 상태를 확인했다. 설치 산출물은 다시 패키징하며 서버 설정과 개인 명단은 포함하지 않는다.

Oracle 구성 근거: [PDB 생성](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/CREATE-PLUGGABLE-DATABASE.html), [Oracle Free 로컬 OS 인증 및 PDB 서비스](https://docs.oracle.com/en/database/oracle/oracle-database/26/xeinw/connecting-oracle-database-xe.html).
