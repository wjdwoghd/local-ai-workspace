# 1단계 데스크톱 앱

> 이 문서는 1단계 구현 당시의 기록입니다. 현재 버전은 로그인이 필요하고 테마·대화 제목은 계정별 Oracle 저장소를 사용합니다. 최신 설치·실행·세션·테스트 방법은 [2단계 안내](auth-stage-2.md)를 따르세요.

Electron + React + TypeScript 기반 한국어 UI 데모입니다. 새 대화, 실행 중 대화 목록 전환, 메시지 입력과 로컬 데모 응답, 설정 화면, 라이트·다크·시스템 테마, 앱 버전을 제공합니다. 모든 응답에 데모임을 표시합니다. 대화는 메모리에만 유지되고 종료하면 사라집니다. 테마만 기기에 저장합니다.

## 설치 및 실행

Windows x64, Node.js 24 LTS와 pnpm 10.34.5를 사용합니다. 저장소 루트에서 실행합니다.

```powershell
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
pnpm dev
```

개발 서버는 `http://127.0.0.1:5173`으로 제한됩니다. 포트를 사용 중이면 기존 프로세스를 확인한 뒤 다시 실행하세요. `ELECTRON_RUN_AS_NODE` 환경변수가 설정된 터미널에서는 해당 변수를 제거하고 실행해야 합니다.

이번 구현 환경에는 Node.js가 없어 `.tools`에 공식 Node.js와 pnpm을 준비했습니다. 이 체크아웃에서 바로 실행하려면 해당 PowerShell 세션의 PATH를 설정할 수 있습니다. `.tools`는 Git에서 제외되므로 다른 체크아웃에서는 위 사전 설치가 필요합니다.

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.2-win-x64;$PWD\.tools\node_modules\.bin;$env:PATH"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --filter @local-ai-workspace/desktop preview
pnpm package:win
```

`test:e2e`는 실제 Electron 창을 실행합니다. 테스트용 임시 프로필을 사용해 테마를 저장·재실행하고 제거합니다. 일반 사용자 설정은 변경하지 않습니다. E2E 결과와 스크린샷은 `apps/desktop/test-results`에 생성됩니다. 패키지 실행 검증은 다음과 같습니다.

```powershell
$env:TEST_PACKAGED_EXE = 'release\win-unpacked\Local AI Workspace.exe'
pnpm --filter @local-ai-workspace/desktop exec playwright test packaged.spec.ts
Remove-Item Env:TEST_PACKAGED_EXE
```

포터블 실행기는 일반 Electron 테스트 주입 방식 대신 로컬 CDP 연결로 검증합니다. 다른 포터블 인스턴스를 모두 닫은 상태에서 실행하세요. 디버깅 포트는 테스트 실행에만 전달하며 일반 앱 실행에서는 열지 않습니다.

```powershell
$env:TEST_PORTABLE_EXE = 'release\Local-AI-Workspace-0.1.0-Portable.exe'
pnpm --filter @local-ai-workspace/desktop exec playwright test portable.spec.ts
Remove-Item Env:TEST_PORTABLE_EXE
```

개발 모드 UI 검증은 `pnpm dev`가 실행 중인 별도 터미널에서 아래 명령으로 수행할 수 있습니다.

```powershell
$env:TEST_RENDERER_URL = 'http://127.0.0.1:5173/'
pnpm --filter @local-ai-workspace/desktop exec playwright test desktop.spec.ts
Remove-Item Env:TEST_RENDERER_URL
```

## 산출물과 설치

- `apps/desktop/dist`: 메인, CommonJS preload, 렌더러 빌드
- `apps/desktop/release/win-unpacked/Local AI Workspace.exe`: 설치 없이 실행하는 앱 폴더. 배포할 때 폴더 전체를 함께 전달해야 합니다.
- `apps/desktop/release/Local-AI-Workspace-0.1.0-Portable.exe`: 단일 파일 포터블 앱
- `apps/desktop/release/Local-AI-Workspace-0.1.0-Setup.exe`: 사용자별 NSIS 설치 프로그램. 설치 경로를 선택할 수 있습니다.

앱 사용자 데이터 폴더(Electron `app.getPath('userData')`, 일반적으로 `%APPDATA%\@local-ai-workspace\desktop` 또는 제품 이름 기반 경로)의 `settings.json`에 테마를 기록합니다. 실제 경로는 OS·배포 형태에 따라 달라질 수 있습니다. 저장 실패는 UI에 표시하고 기존 선택을 유지합니다. 손상된 설정은 시스템 테마로 복구합니다. 설정 파일에는 인증정보나 대화를 기록하지 않습니다.

생성 파일은 서명되지 않았고 기본 Electron 아이콘을 사용합니다. Windows에서 출처 확인 경고가 나올 수 있습니다. 빌드·설치 파일, 테스트 산출물과 로컬 도구는 `.gitignore`에서 제외합니다. 최초 설치·패키징에는 npm 및 공식 Electron/빌드 도구 다운로드를 위한 네트워크가 필요하고, 완성된 데모 앱은 오프라인에서 동작합니다.

## 구조 및 보안

- `apps/desktop/src/main`: 창 생성, 앱 생명주기, 설정 파일 관리 및 IPC 검증
- `apps/desktop/src/preload`: `getInfo()`, `setTheme()` 두 API만 노출
- `apps/desktop/src/renderer`: 레이아웃, 채팅, 설정, CSS 테마. Node.js·파일 시스템 접근 없음
- `packages/shared-types/ipc/desktop.ts`: 메인·preload·렌더러가 공유하는 API 타입
- `apps/desktop/tests`: 입력·URL 보안 단위 테스트와 실제 Electron E2E

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`를 명시합니다. IPC는 소유 WebContents, 최상위 프레임, 정확한 렌더러 URL, 인수 개수 및 테마 열거값을 검증합니다. 일반 IPC 전달 함수나 파일 경로 인수는 공개하지 않습니다. 새 창, 외부 탐색, webview, 권한 요청을 차단합니다. CSP는 외부 스크립트·프레임·객체를 막고, 프로덕션에서는 `connect-src 'none'`으로 네트워크 연결을 차단합니다. 개발 모드에 한해서 React Refresh의 인라인 스크립트와 로컬 HMR 연결을 허용합니다. 사용자 입력은 React 텍스트로 표시합니다.

기본 키보드 조작: Tab/Shift+Tab으로 이동, Enter/Space로 버튼 실행, Enter로 전송, Shift+Enter로 줄바꿈, 라디오 버튼 방향키 선택. 한국어 IME 조합 중 Enter는 전송하지 않습니다. 본문 건너뛰기 링크와 포커스 표시, 입력 레이블, 메시지 로그·저장 상태 알림을 제공합니다. 최소 창 크기는 680×560입니다.

## 범위와 제약

Oracle, 계정·인증, 실제 OpenAI 호출, 검색, 파일 탐색기, 터미널, AI 에이전트 및 GitHub 기능은 구현하지 않았습니다. 데모는 사용자·팀 데이터 격리를 제공하는 인증 시스템이 아닙니다. 다중 사용자 보안·실제 업무 배포 검증은 후속 단계 범위입니다.

구현 참고: [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [electron-builder NSIS](https://www.electron.build/docs/nsis/).
