# 6단계 검증 기록

검증일: 2026-10-30 (Asia/Seoul). Windows 11 x64, Node 24.22.2, pnpm 10.34.5, Electron 42.11.18. 설치된 Codex는 `0.162.0-alpha.17.2`입니다.

**실제 Codex 인증·추론은 실행하지 않았습니다. AI가 실제 개발 작업을 수행하고 테스트하는 6단계 완료 기준은 미충족입니다.** 아래 fixture/로컬 테스트 성공은 실제 모델 연동 성공을 의미하지 않습니다.

## 명령과 결과

| 실행 | 결과 |
| --- | --- |
| `git status --short`, `git branch --show-current`, `git diff --stat` | 시작 시 AGENTS.md만 수정 상태. 기존 `feat/stage-1-electron-ui` 유지, AGENTS.md 수정 없음 |
| `codex --version`, `codex app-server --help` | 설치 바이너리와 stdio/generate-ts 명령 확인 |
| `codex app-server generate-ts --out .tools/codex-stage-6-schema` | 성공. 설치 버전의 초기화/thread/turn/승인 스키마 대조. 실제 inference 아님 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 서버 28 + desktop 45 = 73개 통과. 새 agent 17개, 프로토콜 fixture 7개 포함 |
| `pnpm build` | 서버 및 Electron main/preload/renderer 빌드 통과 |
| `pnpm test:e2e` (제한 환경) | Electron 로그인 화면 로딩 timeout으로 8개 실패, EXE 경로 미지정 2개 skip. 아래 Windows 재실행과 구분 |
| Windows 환경 전체 E2E | 보안 API 목록 assertion 수정 후 8개 통과 (42.7초). EXE smoke 2개는 경로 미지정으로 skip, 별도 실행 |
| `pnpm package:win` | Windows 실행 환경에서 NSIS·portable 생성 성공. 마지막 main 변경은 최신 `pnpm build` 후 `electron-builder --win --x64 --config.compression=store`로 재패키징 성공 |
| 패키징된 EXE의 agent/Monaco/PTY | 최종 4개 모두 통과 (26.9초). `app.isPackaged === true`, 새 agent·인증 만료 거부, Monaco·충돌·실제 ConPTY·계정 전환·서버 장애 정리 포함. 인증 서버는 HTTPS fixture |
| unpacked/단일 portable EXE smoke | 경로를 지정한 별도 실행에서 2개 모두 통과 (11.6초). 로그인 화면·비밀번호 입력 속성·앱 종료 확인. portable의 전체 agent/PTY 시나리오는 별도 미검증 |
| 실제 Codex 모델·계정 entitlement·추론 | 미검증/차단. 코딩 모델 미설정, 서버 전용 인증·도구 브로커 미구현 |
| Windows AI 명령 sandbox·프로세스 트리·네트워크/외부 쓰기 | 미검증/비활성. 사용자 직접 PTY 검증과 구분 |
| Git/비밀값 | `.env`, schema/temp, release는 Git 제외. 서버 키 빈 값 확인(값 출력 없음). 커밋·push·PR 없음 |

## 재현 환경

PowerShell에서 저장소 내 Node/pnpm을 사용했습니다. 제한 환경의 사용자 임시 폴더 조상 `realpath` EPERM은 테스트 임시 경로를 저장소 내부로 지정하여 해결했습니다. 제품의 경로 검증은 완화하지 않았습니다.

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.2-win-x64;$PWD\.tools\node_modules\.bin;$env:PATH"
New-Item -ItemType Directory -Force .tools/stage6-temp | Out-Null
$env:TEMP = "$PWD\.tools\stage6-temp"
$env:TMP = $env:TEMP
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd test:e2e
pnpm.cmd package:win
```

Electron UI는 제한 환경에서 navigation이 완료되지 않아 실제 Windows 실행 환경에서 재시도했습니다. 최초 제한 밖 단위 테스트 요청은 자동 승인 검토 서비스의 모델 용량 부족으로 실행되지 않았습니다. 이후 안전한 임시 경로로 단위 테스트를 통과했고, 별도 Windows Electron 검증 요청은 실행되었습니다. 전체 E2E 첫 Windows 실행은 새 제한형 `agent` API를 반영하지 않은 기존 공개 API 목록 assertion 하나가 실패했습니다. 허용 목록과 `agent.execute` 단일 표면 검사를 수정했습니다.

패키징과 동시 실행한 첫 EXE 검증에서는 기존 PTY 출력의 `PTY_READY` 5초 대기가 한 번 실패했습니다(나머지 3개 통과). 패키징 종료 후 코드를 바꾸지 않고 동일한 4개를 다시 실행하여 모두 통과했습니다. 간헐적인 PTY 초기 응답 지연 가능성은 남습니다. 새 에이전트 명령 기능의 성공으로 해석하지 않습니다.

최종 설치 파일은 `apps/desktop/release/Local-AI-Workspace-0.1.0-Setup.exe`, 단일 portable은 `Local-AI-Workspace-0.1.0-Portable.exe`, EXE는 `win-unpacked/Local AI Workspace.exe`입니다. 최신 재패키징은 압축을 끈 portable이므로 파일이 약 506 MB로 큽니다. 소스의 패키징 설정은 변경하지 않았습니다. 코드 서명 인증서·전용 아이콘은 미설정입니다. 배포용 일반 압축 산출물은 `pnpm package:win`으로 다시 만들 수 있습니다.

패키지 검증은 기존 테스트 전용 HTTPS fixture 및 Git 제외 TLS 파일을 사용합니다. 실제 Oracle이나 운영 인증 서버 검증은 아닙니다. 테스트 인증서의 키 내용은 출력·복사하지 않습니다.

```powershell
$env:TEST_WORKSPACE_PACKAGED_EXE = "$PWD\apps\desktop\release\win-unpacked\Local AI Workspace.exe"
$env:TEST_WORKSPACE_TLS_CERT = "$PWD\.tools\workspace-tls\cert.pem"
$env:TEST_WORKSPACE_TLS_KEY = "$PWD\.tools\workspace-tls\key.pem"
$env:NODE_EXTRA_CA_CERTS = $env:TEST_WORKSPACE_TLS_CERT
pnpm.cmd --filter @local-ai-workspace/desktop exec playwright test agent.spec.ts workspace.spec.ts
```

## 검증 범위

새 단위 테스트는 실제 임시 파일에 대해 승인 전 무변경, Ask 제안 거부, renderer 요청 스키마 우회 거부, digest 변조, 반환된 승인 객체 내용 변경이 원본 제안에 영향 없음, 1회 적용과 재사용 거부, 거절·만료 무변경, 디스크 변경·미저장 편집 충돌, 세션/모드/프로젝트/중단/dispose 후 이전 승인 거부, hard link와 실제 Windows junction 거부, 크기 제한과 부분 적용 결과를 검사합니다. 진행 중 읽기나 적용을 지연시킨 뒤 중단/세션 전환/모드 변경하여 늦은 결과·쓰기 경계를 검사합니다.

프로토콜 fixture는 외부 API·프로세스 없이 transport를 주입합니다. initialize → initialized → thread/start → turn/start → delta → interrupt/close 순서, 줄 분할·한글 UTF-8 바이트 분할, 잘못된 JSON·객체·UTF-8·과도한 프레임, 승인 ID 중복 처리, native 파일/명령 승인 자동 거절, 다른 thread 이벤트 무시, 연결 종료 및 요청 timeout을 검사합니다. 어댑터의 2분 turn timeout은 구현되어 있으나 실제 Codex 장기 turn 검증은 아닙니다. 실제 native 도구 우회 차단을 증명하는 테스트로 취급하지 않습니다.

새 Electron E2E는 실제 main/preload/renderer/Monaco와 파일 IO를 사용하여 Ask/Edit/Agent 전환, 모델·인증 미설정 표시, 로컬 검사, AI 실행 설정 차단, 중단, 미저장 편집 보존과 프로젝트 종료 시 패널 폐기를 확인합니다. 실제 모델 제안이 없으므로 승인 카드의 실모델 E2E·Codex 프로세스 정리·기록 캐시 격리는 검증하지 않았습니다. 승인 엔진은 단위 테스트에서만 fixture 제안을 적용합니다.

마지막으로 새 agent E2E에 서버 세션 만료 후 이전 workspace ID의 status/stop 거부를 추가했고 최신 EXE에서 통과했습니다. 이 테스트 변경 뒤 타입 검사도 재실행해 통과했습니다.

기존 로그인·계정 전환·인증 만료·채팅·검색·Monaco·충돌·ConPTY 회귀 테스트를 유지합니다. 원격 인증 폐기는 다음 `me`/기존 5초 모니터링까지 지연될 수 있습니다. 서버 요청 처리 지연을 포함한 즉시 폐기를 보장하지 않습니다.

## 남은 제약

실제 서버 Codex 실행/중계, 사용자별 도구 브로커, 코딩 모델 allowlist와 entitlement, 실제 native 파일 접근 정책, Windows AI 명령 sandbox는 준비되지 않았습니다. 실제 API 키·사용자 전역 로그인·MCP를 상속하지 않았습니다. 파일 생성·삭제·자동 되돌리기, 명령 추가 권한 승인, 명령 실행 테스트·출력은 비활성입니다. 기존 5단계의 적대적 TOCTOU·특수 reparse tag·ACL·전원 장애·분리된 프로세스 한계도 남습니다. NSIS 설치·업그레이드·제거, 코드 서명·SmartScreen 및 10명 실제 업무 검증은 별도입니다.
