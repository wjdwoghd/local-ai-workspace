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

1단계 Electron + React + TypeScript 데스크톱 UI를 구현했습니다. 로컬 데모 채팅, 대화 목록, 설정 화면과 테마 저장을 제공합니다. 서버·인증·실제 AI 연결은 후속 단계입니다. [설치·실행·빌드·Windows 패키징 안내](docs/development/desktop-stage-1.md)를 참고하세요.

`pnpm-workspace.yaml`은 `apps/*`와 `packages/*`를 워크스페이스 경로로 지정합니다. 공통 패키지의 `package.json`은 각 패키지 구현 시 추가합니다.
