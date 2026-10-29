# 5단계 검증 기록

검증일: 2026-10-30 (Asia/Seoul). Windows 11 x64 (10.0.22631), 로컬 Node 24.22.2, pnpm 10.34.5, Electron 42.11.18, electron-builder 26.18.0, Monaco 0.57.0, node-pty 1.1.0, xterm 6.0.0 / fit addon 0.11.0.

로컬 파일·편집기·실제 PTY와 기존 기능의 자동 검증을 실행했습니다. 인증·채팅·검색 E2E의 서버는 명시적인 fixture이며 실제 Oracle/OpenAI 검증으로 간주하지 않습니다.

## 실행 결과

| 실행 | 결과 |
| --- | --- |
| `pnpm typecheck` | 서버·데스크톱·공유 타입 및 테스트 타입 검사 통과 |
| `pnpm test` | 서버 28개 + 데스크톱 21개 = 49개 통과. 작업공간 단위 테스트 12개 포함 |
| `pnpm build` | 서버·Electron main/preload/renderer 빌드 통과 |
| 최종 Electron 전체 E2E | 기존 인증·채팅·UI/테마/보안·검색 4개 + 작업공간/PTY/장애 정리 3개 + Windows EXE/portable smoke 2개 = 9개 모두 통과 (48.8초). 초기 EXE 환경변수 미지정 실행에서 skip했던 2개도 최종 실행에서는 실제 EXE를 지정해 통과 |
| `pnpm test:oracle` | 전용 `TEST_ORACLE_*` 설정 부재로 통합 테스트 1개 skip. 실제 DB 미검증 |
| `pnpm package:win` | Windows x64 NSIS와 portable 생성 성공. 코드 서명 인증서·제품 아이콘 미설정 메시지 있음 |
| 최종 패키징된 EXE의 작업공간 E2E | `app.isPackaged === true`에서 파일·Monaco worker·실제 ConPTY·서버 장애 시 정리까지 3개 통과 (26.4초). 인증 서버는 HTTPS fixture |
| Git/비밀값 제외 | `git diff --check` 통과. `.env`, 테스트 TLS 키, 빌드·설치 파일은 Git 제외 확인. 커밋·push·PR 없음 |

PowerShell PATH에 pnpm이 없어 저장소 `.tools`의 Node/pnpm을 사용했습니다. `pnpm.ps1` 실행 정책 때문에 `pnpm.cmd`를 호출했습니다. 기존 `node_modules`는 사용자 pnpm store에 연결되어 있으므로 의존성 추가 시 해당 `--store-dir`를 사용했습니다. 기본 제한 환경의 npm 네트워크 EACCES와 임시 사용자 폴더 조상 `realpath` EPERM 때문에 설치 및 실제 파일시스템/Electron 검증은 승인된 Windows 실행 환경에서 재실행했습니다. 이는 앱의 경로 검사 우회가 아닙니다.

## 실제 검사한 동작

단위 테스트는 실제 임시 파일과 디렉터리를 생성해 한 디렉터리 목록만 읽기, 기본 제외 폴더 숨김, UTF-8/BOM/한글/CRLF/CR/혼합 줄바꿈 보존, 잘못된 UTF-8·UTF-16·바이너리·2 MiB 초과 차단, 읽기 전용 실패 시 원본 보존, 수정 버전 충돌과 명시적 덮어쓰기 재검사, 삭제 파일의 자동 재생성 차단을 확인합니다. 임시 저장 파일이 성공 후 목록에 남지 않는 것도 확인합니다.

경로 검사는 절대 경로·상위 탈출·역슬래시·UNC/장치/ADS·예약 장치명·후행 점·잘못된 IPC 구조/크기, 실제 Windows junction 탈출, 하드 링크 차단과 이전 작업공간 ID 거부를 검사합니다. 실제 디렉터리 watcher로 생성·수정·이름 변경·삭제 및 debounce, dispose 이후 이벤트 해제, 루트 삭제 감지를 확인합니다. 선택 도중 dispose되면 뒤늦게 완료된 선택을 채택하지 않는 것도 검사합니다. 셸 환경 허용 목록은 비밀값을 뜻하는 테스트 sentinel을 제외하는지 검사합니다.

Electron E2E는 실제 Electron main/preload/renderer, Windows 파일 IO, Monaco Editor/Diff Editor, blob worker, xterm, node-pty ConPTY를 실행합니다. 폴더 선택창 반환만 테스트 임시 경로로 대체합니다. 실제 네이티브 선택창을 마우스로 조작한 검증은 아닙니다.

- 임시 프로젝트 열기 → 지연 탐색 → 한글 코드 편집 → Ctrl+S → 디스크 바이트/BOM/CRLF 확인 → 탭 닫기와 재열기.
- `constructor` 폴더와 `__proto__` 파일처럼 JavaScript 객체의 기존 속성과 같은 이름도 열기. 탐색기/언어 추정에서 상속 속성을 사용하지 않도록 처리.
- 여러 탭, 읽기 전용 파일 저장 실패 후 편집 내용 유지, 바이너리/큰 파일 안내, 탭 닫기 취소·저장과 폐기, 프로젝트 전환 취소, 일반 창 닫기 취소.
- 외부 파일 생성·이름 변경·삭제의 트리 반영, 수정하지 않은 열린 파일 자동 갱신, 편집 중 외부 수정 시 양쪽 내용 보존, 실제 Monaco diff와 버전 재검사 후 명시적 덮어쓰기, 외부 삭제 뒤 편집 내용 유지.
- Monaco worker가 실제 생성되는지 확인하고 worker 안에서 JavaScript 실행을 확인. worker 관련 console error와 renderer pageerror가 없는지 확인.
- 실제 xterm 입력으로 PowerShell 명령을 실행해 출력 확인. 별도 IPC 시나리오에서 ConPTY 작업 디렉터리·환경 필터·크기 변경·Ctrl+C로 30초 대기 중단·후속 명령·exit code 7·재시작을 확인.
- 실제 셸과 숨김 일반 자식 PowerShell의 PID를 받아 작업공간 전환 뒤 둘 다 종료되었는지 확인. 다른 실제 폴더로 전환하며 이전 파일/터미널 ID를 거부하는지 검사. 로그아웃 뒤 실행 중 셸 PID의 종료 및 다음 계정의 이전 핸들 접근 차단 확인.
- 선택 취소 시 기존 작업공간 유지, 위조 호출 프레임·잘못된 IPC·루트 밖 경로·junction 경로 차단. 인증 만료 뒤 파일과 PTY 요청 차단.
- UI에서 채팅으로 이동한 상태의 로그아웃 저장 확인 대화상자와 계정 전환 후 파일·탭·프로젝트가 남지 않는지 확인.
- 기존 로그인 실패·관리자 권한·사용자별 대화 분리·테마 재로그인 복원·채팅 스트리밍/중단·검색 문서 등록/출처/분리를 회귀 검사.

## Windows 패키지 검사

산출물은 Git 제외 경로 `apps/desktop/release/`에 생성합니다.

- `win-unpacked/Local AI Workspace.exe`
- `Local-AI-Workspace-0.1.0-Setup.exe`
- `Local-AI-Workspace-0.1.0-Portable.exe`

패키징은 node-pty 전체를 ASAR 밖으로 추출하며, native `.node`와 ConPTY DLL/worker가 실제 포함되어 있음을 확인했습니다. 단순 Node 테스트로 Electron ABI 호환을 추정하지 않고, Electron main과 패키징된 EXE에서 PTY를 생성·중단·종료해 검증했습니다.

마지막 소스까지 반영한 `pnpm build` 후 `pnpm --filter @local-ai-workspace/desktop exec electron-builder --win --x64`를 실행해 NSIS와 portable을 재생성했습니다. 최종 전체 E2E에서는 `TEST_PACKAGED_EXE`에 win-unpacked EXE, `TEST_PORTABLE_EXE`에 단일 portable EXE를 지정했습니다. 이 두 smoke는 로그인 화면·비밀번호 입력 타입·실행만 확인합니다. 파일/worker/PTY 전체 동작은 별도의 패키징된 win-unpacked EXE 3개 시나리오에서 확인했으며, portable 런처를 통한 로그인 이후 전체 파일/PTY 시나리오는 별도로 실행하지 않았습니다. packaged smoke의 서버 주소는 HTTPS 루프백 주소로 지정하고 실제 서버 요청은 하지 않았습니다.

패키징된 앱 검증에는 fixture를 HTTPS로 열고, `.tools/workspace-tls/`에 생성한 테스트 전용 자체 서명 인증서를 `NODE_EXTRA_CA_CERTS`로 신뢰시켰습니다. 앱의 packaged HTTPS 요구사항이나 인증을 우회하지 않았습니다. 인증서의 개인키는 Git 제외 경로에만 두며 제품·문서·로그에 넣지 않습니다. 재현하려면 테스트 인증서/key 경로와 검증할 EXE를 지정합니다.

```powershell
$env:TEST_WORKSPACE_PACKAGED_EXE = 'C:\local-ai-workspace\apps\desktop\release\win-unpacked\Local AI Workspace.exe'
$env:TEST_WORKSPACE_TLS_CERT = 'C:\local-ai-workspace\.tools\workspace-tls\cert.pem'
$env:TEST_WORKSPACE_TLS_KEY = 'C:\local-ai-workspace\.tools\workspace-tls\key.pem'
$env:NODE_EXTRA_CA_CERTS = $env:TEST_WORKSPACE_TLS_CERT
pnpm --filter @local-ai-workspace/desktop exec playwright test workspace.spec.ts
```

이 환경변수들은 테스트 셸에만 설정합니다. 기본 개발 E2E를 재실행할 때는 `TEST_WORKSPACE_PACKAGED_EXE`를 제거합니다. 테스트 인증서는 검증 대상 루프백 IP의 SAN이 있어야 하고 유효해야 합니다. 실제 서버는 운영 인증서를 사용해야 합니다.

## 수정 후 재검증한 실패

초기 Monaco E2E의 입력 대상이 최신 Chromium의 EditContext와 달랐습니다. Monaco를 명시적 textarea 입력 모드로 구성해 실제 키 입력·저장을 확인했습니다. 외부 변경 안내는 Monaco 내부 접근성 alert와 구분해 검사하도록 테스트 선택자를 수정했습니다. 실패한 테스트의 정리가 저장 확인창에 막히던 부분은 테스트 종료 때 해당 테스트 창만 destroy하도록 보완했습니다. 제품의 일반 창 닫기 취소는 별도로 검사합니다.

Electron의 동기 JavaScript 확인창 대신, 충돌 비교 화면의 명시적인 덮어쓰기 버튼을 사용합니다. PowerShell 초기 프롬프트 이전 첫 키가 유실되는 경우는 UI가 첫 출력 전 입력을 비활성화하도록 보완했습니다. Ctrl+C 직후의 테스트 입력은 프롬프트 복귀를 확인한 뒤 전송합니다. ConPTY DLL과 실제 프로세스 트리 정리를 사용해 종료 때 추가 Electron 인스턴스나 셸이 남는지 확인했습니다.

## 남은 검증과 한계

실제 Oracle 스키마/10개 계정, 실제 Astra/API·웹 검색, 운영 HTTPS 서버, 10명 동시 업무 사용은 검증하지 않았습니다. 실제 서비스 대신 fixture를 사용한 결과와 구분해야 합니다. 설치 프로그램의 설치·업그레이드·제거, 코드 서명·SmartScreen, ARM64, 구형 Windows 및 다른 OS도 미검증입니다.

현재 파일시스템 테스트는 Windows 임시 폴더의 일반 파일과 junction/hard link, DOS 읽기 전용 속성을 사용합니다. 실제 물리 드라이브 연결 해제·특수 reparse tag·Windows ACL 거부·네트워크 매체·백신 잠금·전원 장애·적대적인 TOCTOU 교체 공격·분리된 서비스 프로세스 종료는 검증하지 않았습니다. 수천 항목/최대 탭/대량 PTY 출력의 성능 부하 시험도 별도입니다. 경로와 저장 보장 범위는 [사용·보안 안내](workspace-stage-5.md)에 명시했습니다.

최초 시도에서는 4단계 미커밋 변경을 확인했습니다. 재개 시점에는 사용자가 반영한 4단계 커밋 `03fd587`이 HEAD였고, 기존 미커밋 변경은 `AGENTS.md`뿐이었습니다. 이 작업은 기존 `feat/stage-1-electron-ui` 브랜치를 유지하고 `AGENTS.md`를 수정하지 않았습니다. 이번 변경은 desktop 구현·공유 작업공간 타입·관련 테스트/패키징·이 문서/README/lockfile입니다. 서버 제품 코드·Oracle SQL·모델 설정·`.env`는 변경하지 않았습니다. 커밋·push·PR은 수행하지 않았습니다.
