# 7단계 검증 결과

검증일: 2026-10-30 (사용자 시간대 Asia/Seoul). 현재 개발 저장소의 커밋·push·PR은 실행하지 않았다. Git 커밋은 테스트가 만든 임시 저장소에서만 수행했다. 기존 `AGENTS.md`의 미커밋 변경(80줄 추가)을 보존했다.

| 검증 | 결과 및 범위 |
| --- | --- |
| `pnpm typecheck` | 서버·데스크톱 통과. 최종 build에도 타입 검사 포함 |
| `pnpm build` | 서버 ESM, Electron main/preload/React·Monaco renderer 빌드 통과 |
| `pnpm test` | 서버 34개 + 데스크톱 55개 = 89개 통과. 신규 협업/Git 단위 테스트 16개 포함 |
| 최종 팀 집계 membership 잠금 보강 후 서버 협업 테스트 | 6개 재실행 통과 |
| Windows 전체 Electron E2E | 9개 통과, EXE 경로 미지정으로 packaged/portable 2개 skip. 아래 신규 UI 보강 뒤 대상 테스트도 재실행 |
| 최종 Git/검색 UI 보강 후 대상 E2E | 2개 통과. 미수집 사용량의 확인 불가 표시·일반 사용자에게 팀 집계 UI 미노출·개인 범위 변경 확인 흐름 추가 검증 |
| 제한 환경 Electron 실행 | 로그인 화면 file navigation timeout. 일반 Windows 실행 환경에서 같은 Git UI 테스트 재실행 통과 |
| `pnpm test:oracle` | 전용 `TEST_ORACLE_*` 설정이 없어 1개 통합 테스트 skip. Oracle 검증 성공으로 간주하지 않음 |
| Git/비밀정보 확인 | diff whitespace 검사 통과. 서버 `.env`는 Git 제외이며 `OPENAI_API_KEY` 빈 값 유지 확인(값 출력 없음) |

## 실제 로컬 Git 검증

실제 Git for Windows와 임시 `.git` 저장소를 사용했다. status·한글 경로·현재 브랜치·diff, 선택 파일 스테이징·첫 커밋 전 해제·커밋에 다른 파일 미포함, 변경된 승인·세션 변경·거절·중복 사용·만료·dispose 거부를 검사했다. `.env` 외부 스테이징 후 커밋 차단, 내용 비표시 스테이징 해제와 파일 보존, 알려진 토큰 내용 차단, 삭제된 토큰의 이력 탐지, 원격 URL 재작성 거부도 포함한다.

실제 로컬 merge 충돌 파일을 만들고 status에 충돌 표시, 커밋 차단 및 원문 보존을 확인했다. pull 테스트의 GitHub 네트워크와 FETCH_HEAD는 adapter fixture이며 비교 diff·실제 `merge --ff-only`의 성공과 분기된 이력의 거부·HEAD/파일 보존은 실제 Git으로 확인했다. 실패하는 실제 pre-commit hook이 커밋을 막고 index를 보존하는 것도 검사했다. hook 출력은 IPC에 반환하지 않는다.

GitHub 테스트는 로그인명·ls-remote·fetch·push·PR 응답을 주입한다. 실제 GitHub API를 호출하지 않는다. 정확한 HTTPS 대상과 브랜치 refspec, force 없음, 명시적 PR head/body-file, URL 반환, 네트워크·인증·권한 오류 시 실패 기록 및 로컬 변경 보존을 확인했다. 실제 GitHub OS credential store 저장·계정 scope·SSO·push/pull·PR 생성은 **미검증**이다.

## 권한·사용량 검증

서버 단위 테스트는 위조 owner/사용량 입력 거부, 인증 선행, 사용자 ID 바인딩·개인 조회 SQL 필터, 비소유자/팀 미소속 공유 변경 거부, 일반 사용자/비소속 관리자의 집계 거부, 소속 관리자에게 팀 총합만 반환, usage 정수·합계 검증·run별 중복 방지 SQL과 provider → 서버 기록 흐름을 검사한다. Oracle 드라이버의 fixture 연결을 사용하므로 실제 SQL 실행·동시성·격리를 증명하지 않는다.

기존 Oracle 통합 테스트에 10명 각자의 작업 기록·사용량, 타인의 대화로 사용량 저장 거부, 팀 집계, 공유→조회 가능→공유 해제→접근 거부, 팀에서 제외된 소유자의 공유 변경 거부를 추가했다. 이 통합 테스트는 현재 환경에서 실행되지 않았다. 별도의 `LAW_TEST_*` 스키마와 확인 변수를 준비한 후 `pnpm test:oracle`로 검증해야 한다. 운영 스키마에서는 실행하지 않는다.

Electron UI 테스트는 fixture 인증 서버와 실제 main/preload/renderer/Git을 사용한다. 보호 파일 선택 차단, 승인 전 index 무변경, 선택 파일만 스테이징, 전체 staged diff 검토·커밋, 인증 만료 후 Git 요청 거부를 확인했다. 기존 로그인·계정 전환·캐시 정리·채팅 복원·검색 출처·Monaco·충돌·실제 ConPTY 회귀도 통과했다. 팀 변경과 실제 수집 usage의 Oracle 연계 UI는 미검증이다.

## 재현 명령

현재 환경에서는 저장소 내부 도구와 임시 폴더를 사용했다. 일반 설치된 Node/pnpm 환경이라면 PATH 설정은 생략한다.

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.2-win-x64;$PWD\.tools\node_modules\.bin;$env:PATH"
$env:TEMP = "$PWD\.tools\stage6-temp"
$env:TMP = $env:TEMP
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @local-ai-workspace/desktop exec playwright test
pnpm test:oracle
```

초기 Git 테스트는 한글 파일명 quote 설정과 Windows 프로세스 호출이 5초를 초과하는 문제로 실패했다. fixture에 `core.quotepath=false`와 파일 단위 30초 test timeout을 적용했다. pull fixture의 FETCH_HEAD 형식이 Git의 실제 형식과 달라 실패한 부분도 수정한 뒤 재검증했다. 제품의 경로/인증/승인 검증을 완화하지 않았다.

새 Windows 설치 프로그램 제작·설치 검증, 실제 GitHub 및 Oracle 동시 권한 폐기, 대규모 이력 성능, 실 API 청구서와 비교, 10명 실사용 검증은 수행하지 않았다. [설정·사용법·제약](collaboration-stage-7.md)을 확인하고 외부 환경 검증 후 운영 완료를 판단해야 한다.
