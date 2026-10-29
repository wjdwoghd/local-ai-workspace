# local-ai-workspace

로컬 AI 워크스페이스를 위한 모노레포 기본 구조입니다.

- `apps/desktop`: Electron 메인 프로세스, preload, 렌더러, 에이전트 워커
- `apps/server`: 서버 모듈, AI 연동, Oracle 접근, 스토리지
- `packages`: 에이전트, 검색, 공통 타입, 보안, UI 모듈
- `database/oracle`: 스키마, 마이그레이션, 인덱스, 시드, 스크립트
- `infrastructure`: 배포, 프록시, Oracle, 모니터링
- `tests`: 단위, 통합, 권한, E2E 테스트
- `docs`: 아키텍처, API, 데이터베이스, 보안, 개발 문서
- `scripts`: 개발 및 운영 스크립트

Electron + React + TypeScript 데스크톱과 Oracle 인증 서버, 개인 AI 채팅, 4단계 웹·파일 검색을 구현했습니다. Astra Responses API 스트리밍·중단, 사용자별 대화 저장·복원, 웹 검색, PDF·Office 문서 검색과 출처 확인을 제공합니다. API 키가 비어 있으면 실제 호출을 막으며, 명시적으로 선택한 데모는 별도로 표시합니다.

[2단계 Oracle 준비·환경 변수·초기 관리자·실행·테스트 안내](docs/development/auth-stage-2.md)와 [검증 결과](docs/development/auth-stage-2-validation.md)를 참고하세요. 현재 실행에는 서버와 Oracle이 필요합니다. [1단계 UI·Windows 패키징 안내](docs/development/desktop-stage-1.md)는 초기 구현의 기록입니다.

[3단계 설정·실행 안내](docs/development/chat-stage-3.md)와 [검증 결과](docs/development/chat-stage-3-validation.md)를 참고하세요. 서버 스키마 2 마이그레이션이 필요하며, 실제 API 사용에는 서버 로컬 키와 Astra 모델 접근 권한이 필요합니다. 실제 Oracle·유료 API 검증은 별도입니다.

`pnpm-workspace.yaml`은 `apps/*`와 `packages/*`를 워크스페이스 경로로 지정합니다. 공통 패키지의 `package.json`은 각 패키지 구현 시 추가합니다.

[4단계 설정·사용 안내](docs/development/search-stage-4.md)와 [검증 결과](docs/development/search-stage-4-validation.md)를 참고하세요. 현재 서버에는 스키마 3 마이그레이션이 필요합니다. 문서 등록·검색은 API 키 없이 사용할 수 있으며, 실제 AI 답변과 웹 검색에는 서버 키 및 해당 모델·도구 접근 권한이 필요합니다.
