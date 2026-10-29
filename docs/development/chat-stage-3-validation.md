# 3단계 검증 결과

검증일: 2026-10-29 (Asia/Seoul). Windows x64, 로컬 Node.js 24.22.2, pnpm 10.34.5.

**구현과 테스트 대역을 사용한 검증을 완료했습니다. 실제 Oracle·실제 Astra API·팀원 10명 실사용은 미검증입니다.** 키·DB가 준비되지 않아 단계 완료 기준의 실제 환경 충족을 보장하지 않습니다.

| 검증 | 결과 |
| --- | --- |
| `pnpm typecheck` | 서버·데스크톱·공유 타입·테스트 통과 |
| `pnpm test` | 서버 17개, 데스크톱 7개, 총 24개 통과 |
| `pnpm build` | 서버와 Electron main/preload/renderer 빌드 통과 |
| `pnpm test:e2e` | 실제 Electron 창 3개 시나리오 통과. 패키지·포터블 2개는 EXE 환경변수 미지정으로 skip |
| `pnpm test:oracle` | 전용 TEST_ORACLE_* 설정 부재로 1개 시나리오 skip |
| 비밀정보 | 기존 `apps/server/.env` 수정 없음, API 키 항목 공란·Git 제외 확인. desktop 소스·산출물에 서버 API 키 참조 없음 |
| Git | 기존 `feat/stage-1-electron-ui` 및 사용자의 AGENTS.md 80줄 추가 보존. `git diff --check` 통과. 구현 검증 후 사용자 요청으로 3단계 파일만 커밋·push하며 AGENTS.md는 제외 |

단위 테스트는 공란 키·미허용 모델에서 API 호출 없음, 계정 모델 ID 확인 후 Responses 요청, 선택한 대화 컨텍스트만 전달, `store:false`, 권한 오류 은닉, UTF-8 한글·한 바이트 chunk·CRLF SSE 처리, failed/incomplete/error/잘린 연결 거부, 세션 폐기 시 전달·저장 금지, 완료 저장 후 done 전달, 중단 시 미저장, HTTP SSE no-store/no-buffering, main에만 bearer 보관과 로그아웃 시 stream abort를 확인합니다. 2단계의 인증·설정·보안 테스트도 유지했습니다.

Electron E2E는 실제 Oracle/OpenAI 대신 명시적 로컬 HTTP fixture를 사용합니다. 실시간 조각 수신, 응답 중단과 미저장 복원, 서로 다른 대화의 독립 입력, 후속 질문의 같은 대화 기록 전달, 재로그인 후 본문 복원, 다른 사용자에게 본문·제목 숨김, 대화 삭제, 데모 선택, 테마 재실행 복원과 Electron 보안 설정을 확인합니다. `apps/desktop/test-results/chat-stage-3.png` 등 화면은 Git 제외된 테스트 산출물입니다.

최초 제한된 실행 환경에서는 Electron 세 시나리오가 창 시작 시 시간 초과되었습니다. 앱 실행이 가능한 환경에서 재실행해 3개 통과를 확인했습니다. 최초 새 단위 테스트의 일부 비동기 test double 반환 누락도 수정한 뒤 전체 24개 통과를 확인했습니다.

실제 Oracle 통합 시나리오에는 기존 10명 인증·RBAC·개인 데이터 CRUD 외에 메시지 소유권, 관리자 포함 타인 접근 거부, CLOB 저장·복원, 새 서비스 인스턴스의 기록·생성 lease 확인, 잘못된 생성 ID의 저장 거부, 대화 삭제 cascade 검사를 추가했습니다. DB가 없어 SQL 실행 결과는 확인하지 못했습니다.

남은 검증은 실제 Oracle 001→002 마이그레이션·재실행, 테스트 스키마 10명 격리, 서버 로컬 키 설정 후 Astra 모델 접근과 실제 응답, 실제 HTTPS SSE 프록시, 여러 서버·기기 동시 요청과 장시간 스트리밍·장애 복구입니다. 이번 단계에서는 Windows 설치 파일을 재생성하지 않았습니다. 실제 환경 설정 절차는 [3단계 안내](chat-stage-3.md)에 있습니다.
