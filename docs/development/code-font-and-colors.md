# D2Coding과 구문 색상 — 0.1.4

Monaco 편집기, Diff 양쪽, 채팅의 인라인 코드와 코드 블록, xterm 터미널에 D2Coding을 적용했다. NAVER 공식 저장소의 Regular/Bold 원본을 앱에 포함하므로 OS 글꼴 설치나 런타임 다운로드가 필요 없다. 최초 화면 전에 두 글꼴을 로드해 Monaco와 xterm의 글자 폭 측정에 사용한다. 문서 본문과 UI 글꼴은 기존 설정을 유지한다.

글꼴 출처는 [naver/d2-coding-font](https://github.com/naver/d2-coding-font/tree/48d294137e3b65158deef2f5846d2e335e43f92f/fonts/ttf), 고정 커밋은 `48d294137e3b65158deef2f5846d2e335e43f92f`다. 파일을 변환하지 않고 원본 TTF를 사용한다. OFL 원문과 저작권 표시는 `assets/d2coding/OFL.txt` 및 Work 설정의 `D2Coding 글꼴 라이선스 (OFL)`에 포함한다.

## 편집기와 채팅

밝은/어두운 편집기 테마에서 키워드·문자열·숫자·주석·타입을 구분하는 색상을 지정했다. 기존 언어 외에 PowerShell·Shell·YAML·XML 토크나이저를 실제로 등록해 확장자만 지정되고 강조되지 않던 경우를 보완했다. 채팅 코드 블록도 구문 색상을 강화하고 PowerShell 정의를 추가했다. 언어가 없는 코드 블록은 제한된 언어 목록에서 자동 감지한다. 일반 텍스트나 지원하지 않는 언어에 정확한 구문 강조를 보장하지 않는다.

## 터미널

PowerShell은 자식 프로세스 시작 시 정해진 초기화 코드로 PSReadLine을 불러온다. 명령어는 청록, 매개변수는 노랑, 문자열은 초록, 변수·키워드는 보라, 숫자는 빨강 계열로 구분한다. PSReadLine 2의 `Colors`와 이전 버전의 `TokenKind` 방식을 지원하며 모듈이 없으면 경고를 표시한다. 프롬프트의 현재 경로도 색상으로 표시한다. OS의 PowerShell 프로필·실행 정책·글꼴 설치 설정은 변경하지 않는다.

xterm에 밝은 ANSI 16색 팔레트와 최소 대비를 적용하고, 셸 환경에 `TERM=xterm-256color`, `COLORTERM=truecolor`, `CLICOLOR=1`을 정해 제공한다. Git Bash에는 현재 경로가 보이는 컬러 프롬프트를 적용한다. Git Bash의 입력 중 토큰 강조는 추가하지 않았으며, 프로그램 출력은 프로그램이 보내는 ANSI 색상을 표시한다. 프로그램이 원래 색을 출력하지 않으면 임의로 문자열을 해석해 다시 칠하지 않는다. PowerShell 설정 근거는 [Microsoft PSReadLine 문서](https://learn.microsoft.com/en-us/powershell/module/psreadline/set-psreadlineoption)다.

좁은 화면의 2행 터미널에서 긴 프롬프트와 명령을 편집하면 이 PC의 PSReadLine 2.0 재그리기가 깨지는 것을 확인했다. 패널 최소 높이를 200px, 실제 터미널 영역을 104px로 확보해 줄바꿈된 명령을 편집할 공간을 유지한다.

## 검증과 실행

데스크톱 타입 검사·빌드와 작업 공간 단위 테스트 14개를 통과했다. 실제 Electron E2E에서 번들 글꼴 두 굵기 로드, Chromium이 사용하는 실제 D2Coding 글꼴, 편집기·Diff 양쪽 글꼴, TS/PS1 토큰별 서로 다른 색, PowerShell 입력 중 네 종류 이상의 색, 라이트/다크 전환을 확인했다. 기존 터미널 재시작, Git Bash 명령 실행, 채팅 코드 블록의 글꼴·색상, 첨부·마크다운과 보안·설정 테스트도 통과했다.

실행기는 `apps/desktop/release/0.1.4/win-unpacked/Local AI Workspace.exe`를 사용한다. 기존 앱의 작업을 저장하고 종료한 뒤 `.tools/Start-Team-App.cmd`로 다시 연다. 서버는 이전 0.1.3의 첨부 지원 서버를 그대로 사용하므로 이 변경으로 서버를 재시작하거나 메모리 대화를 초기화하지 않는다. 이전 포터블·설치 파일은 다시 만들지 않았다.

최종 0.1.4 Windows 실행 파일에서도 실제 글꼴·편집기·Diff·PowerShell 색상, 마크다운·첨부, 통합 작업·터미널 E2E 3개를 통과했다. 테스트는 격리된 임시 프로필과 모의 AI 서버를 사용했으며 사용자 작업 폴더와 실제 API 키는 사용하지 않았다.
