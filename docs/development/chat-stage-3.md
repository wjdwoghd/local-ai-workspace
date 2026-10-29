# 3단계: 개인 AI 채팅

서버의 OpenAI Responses API 호출, SSE 스트리밍, 중단, 서버 모델 목록 선택, Oracle 메시지 저장·복원과 대화별 컨텍스트를 구현했습니다. 2단계 Oracle 인증 서버가 선행 조건입니다. 운영 준비 완료 여부는 [검증 결과](chat-stage-3-validation.md)를 참고하세요.

## Astra 확인

2026-10-29 공식 [GPT-6 Astra 모델 문서](https://developers.openai.com/api/docs/models/gpt-6-astra)에서 제공업체 OpenAI, 모델 ID `gpt-6-astra`, Responses API, 스트리밍, function calling, web/file search 지원을 확인했습니다. 이번 단계에서는 텍스트 채팅만 요청하며 검색 도구는 4단계 범위입니다. [공식 스트리밍 안내](https://developers.openai.com/api/docs/guides/streaming-responses)를 기준으로 Responses 의미 이벤트를 처리합니다.

공식 지원과 개별 계정 권한은 별개입니다. 현재 키가 공란이므로 실제 계정 접근 권한과 유료 API 응답은 검증하지 않았습니다. 서버는 전송마다 해당 ID를 [Models 조회 API](https://developers.openai.com/api/reference/resources/models/methods/retrieve)로 확인한 다음, 성공할 때만 대화 내용을 Responses API에 보냅니다. 권한·사용량·지원 오류 시 다른 모델로 대체하지 않습니다. 모델 조회 성공만으로 Responses 실행 권한이나 잔액까지 보장하지는 않습니다.

## 설정과 실행

1. [2단계 준비 안내](auth-stage-2.md)에 따라 Oracle, 서버 세션 비밀값, 사용자 계정을 준비합니다.
2. `apps/server/.env.example`을 참고해 서버 로컬 `.env`를 설정합니다. 기존 파일을 덮어쓰지 마세요. `OPENAI_API_KEY`는 사용자가 서버에서만 직접 입력합니다. 키를 데스크톱 설정이나 채팅에 입력하지 않습니다. 이번 구현 작업은 기존 키 항목을 수정하지 않습니다.
3. `OPENAI_ASTRA_MODEL_ID=gpt-6-astra`가 기본값입니다. 실제 ID와 표시명은 서버에서 관리하며 데스크톱은 인증 후 서버 목록을 받습니다. 추가 모델은 공식 Responses·streaming 지원 및 계정 접근 권한을 운영자가 확인한 뒤 `OPENAI_ADDITIONAL_MODELS`에 `[{"id":"공식 API ID","label":"표시명"}]` 형식으로 지정합니다. 기본 Astra와 중복 ID, UI 예약 ID `demo`는 거부합니다.
4. 서버 실행 위치에서 `pnpm --filter @local-ai-workspace/server db:migrate`를 실행합니다. 기존 1 버전 스키마에 `002_chat.sql`을 적용해 2로 올립니다. 빈 스키마는 001·002 순서로 적용합니다. Oracle DDL은 별도 커밋되므로 적용 전 운영 백업을 준비하세요. 서버는 스키마 2를 요구합니다.
5. `pnpm dev:server`, 별도 터미널에서 `pnpm dev`를 실행합니다. 데스크톱의 `AUTH_SERVER_URL`은 2단계와 동일하며 운영·패키지에서는 HTTPS가 필요합니다.
6. 운영 프록시에 `apps/server/deploy/nginx.conf.example`의 `/api/chat` SSE 경로를 반영합니다. buffering을 끄고 140초 read timeout을 사용합니다. `/api/action` 경로도 계속 필요합니다.

키가 비어 있으면 서버는 OpenAI를 호출하지 않으며 UI는 설정 필요 상태로 전송을 막습니다. 모델 선택에서 `Astra · 로컬 데모`를 직접 선택하면 기존 화면 체험을 사용할 수 있습니다. 데모는 실제 응답으로 자동 대체되지 않으며 메시지는 서버 저장·AI 입력에서 제외합니다. 대화 제목·테마는 데모에서도 저장됩니다.

## 저장·컨텍스트와 중단

- 목록·본문·삭제·생성은 인증된 사용자 범위에서만 처리합니다. 관리자도 다른 사용자의 대화를 읽을 수 없습니다. 계정 전환·만료·종료 시 데스크톱 메모리와 진행 중 스트림을 정리합니다. 로그인 토큰은 Electron main 메모리에만 있습니다.
- 질문·답변 한 쌍을 완료 시 한 트랜잭션으로 저장합니다. 본문은 Oracle CLOB이며 대화 삭제 시 메시지와 생성 잠금을 cascade 삭제합니다. 로그인 후 대화 선택 시 본문을 복원합니다.
- API 입력은 선택한 대화의 완료된 메시지와 새 질문뿐입니다. `store:false`로 보내며 다른 대화의 response ID나 제공업체 저장 세션을 공유하지 않습니다. 데모 메시지는 입력하지 않습니다. 모델을 바꾸면 같은 대화의 완료된 기록을 이어 사용합니다.
- 대화당 100턴(200개 메시지), 입력 컨텍스트 100,000 UTF-16 코드 단위, 새 질문 4,000자, 요청당 출력 4,096 토큰·32,000자, 서버 생성 시간 120초 한도를 둡니다. 한도 초과 시 자동으로 기록을 잘라내지 않고 새 대화를 안내합니다.
- 생성 중 대화 전환·생성·삭제·모델 변경과 중복 전송을 막습니다. 별도 기기·서버 인스턴스에서도 Oracle의 3분 생성 lease로 같은 대화의 중복 생성을 거부합니다. 서버 종료로 남은 lease는 만료 후 재시도할 수 있습니다. 스트리밍 동안 DB 연결·트랜잭션을 계속 잡지 않습니다.
- 각 출력 조각을 전달하기 전과 저장 전에 세션·소유권을 재검사합니다. 중단·실패·잘린 스트림·불완전 응답은 정상 대화로 저장하지 않습니다. `응답 중단`은 클라이언트 연결과 서버 upstream 요청을 취소합니다.
- 저장 완료와 최종 이벤트 사이에 연결이 끊길 수 있으므로 실패 시 서버 기록을 다시 불러옵니다. 자동 재전송은 하지 않습니다. 재조회도 실패하면 전송을 막고 `다시 불러오기`를 안내합니다. 중단 시 이미 사용한 제공업체 토큰의 청구 취소를 보장하지 않습니다.

## 검증 명령

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:oracle
```

단위 테스트와 Electron E2E는 명시적 테스트 대역으로 실행하며 실제 API 과금은 발생하지 않습니다. 실제 Oracle 테스트는 전용 빈 `LAW_TEST_*` 스키마 및 `TEST_ORACLE_*` 설정이 필요합니다. 기존 운영 계정이나 데이터가 있는 스키마에서는 실행하지 않습니다. 키·권한 준비 후 실제 환경에서 여러 계정의 스트리밍·재로그인 복원·동시 요청·삭제·중단·만료를 별도로 확인해야 합니다.
