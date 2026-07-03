# Intra-Chat PoC 개발 작업 로그

> 요구사항: "작업 대화 및 발생하는 로그는 별개 로그 파일로 저장 필수"
> 이 문서는 개발 진행 중의 주요 작업 내역/결정 사항을 시간순으로 기록한다.
> (런타임 애플리케이션 로그는 `logs/app.log`에 winston으로 별도 기록된다.)

## 2026-07-03

### 계획 확정
- 스택: TypeScript, 서버(Node+Express+Socket.IO+better-sqlite3), 클라이언트(Electron+React+Vite)
- 진행 방식: 수직 슬라이스(로그인 → 공개 채널 실시간 텍스트) 우선 완성 후 파일/DM/그룹 확장
- 사용자 확인 완료: 언어=TypeScript, 범위=수직 슬라이스 우선

### Phase 1 - 스캐폴딩 (scaffold)
- 모노레포 구조 생성: npm workspaces (`shared`, `server`, `client`)
- `shared/src/index.ts`: 도메인 엔티티 + REST/Socket.IO 타입 계약 정의
- `.gitignore`, 루트 `package.json`, 작업 로그 문서 생성

### 서버 구현 (server-db / server-auth / server-realtime)
- SQLite 스키마/인덱스 초기화(`db/index.ts`), 리포지토리(users/rooms/messages)
- 관리자 계정 발급 CLI `scripts/create-user.ts` (FR-01)
- 로그인 REST + bcryptjs 해시 + JWT 발급/검증 (FR-02, FR-03)
- Socket.IO JWT 인증 미들웨어, 방 join/브로드캐스트, 메시지 저장, 히스토리 페이지네이션 (FR-11~13)
- 채널/그룹/DM 관리 라우트(FR-06~10), 파일 업로드/다운로드 라우트(FR-16~24)
- 관리자 라우트: 계정 생성/비활성화/삭제 + 세션 즉시 종료 (FR-04)
- 온라인/오프라인 상태 추적(FR-25,26), winston 로그(logs/app.log)

### 클라이언트 구현 (client-shell / client-login / client-chat + Phase2~4)
- Electron main/preload(contextBridge) + electron-vite + React 렌더러
- 로그인 화면 + 토큰 저장/자동 로그인 (FR-02, FR-05)
- 사이드바(채널/그룹/DM 구분 + 미읽음 배지 + 방 생성/나가기), 실시간 채팅창
- 메시지 발신자/시각 표시(FR-14), Enter/Shift+Enter(FR-15), 위로 스크롤 페이징(FR-13)
- 파일 드래그앤드롭/다중 첨부/진행률(FR-16~18), 이미지 미리보기·라이트박스(FR-21), 파일 다운로드(FR-22)

### 검증
- 서버/클라이언트 TypeScript 타입체크 통과(`tsc --noEmit`)
- 헤드리스 end-to-end 검증(임시 DB, 서버 실제 기동):
  - 로그인+JWT, 기본 채널 자동 합류, 2개 소켓 연결
  - 실시간 메시지 송수신 성공(전달 지연 실측 8ms, 1초 이내 목표 충족)
  - 발신자 표시이름, DB 영구 저장/히스토리 조회 확인
  - 파일 업로드(201)/다운로드 내용 일치, message_type='file' 저장 확인
- 참고: 이 환경은 GUI가 없어 Electron 창 실행 대신 서버 측 슬라이스를 검증. GUI는 타입체크로 확인.
- 실행 환경 메모: 이 샌드박스는 tsx CLI의 IPC(unix socket)를 막으므로 검증 시 `node --import tsx/esm` 사용.
  일반 개발 환경에서는 `npm run server:dev`(tsx) 로 정상 동작.

### 기술 결정 메모
- 네이티브 빌드 회피: `bcrypt` -> `bcryptjs`(순수 JS)로 교체, `better-sqlite3`는 사전 빌드 바이너리가 있는 v12로 상향

### Phase 5 - 패키징/배포
- `client/electron-builder.yml`: Windows portable exe 빌드 설정
- 루트 `README.md`: 실행/계정발급/패키징/오프라인 반입/운영 가이드 작성

## 2026-07-03 (v3.0 - 업무 연동 기능 추가)

요구사항 명세서 v3.0 반영: AI 채팅(Ollama), Yona 이슈, Jenkins 빌드 연동.

### 데이터 모델 확장
- `rooms.type`에 `'ai'`, `messages.message_type`에 `'ai_response'|'card'`, `messages.metadata`(카드 JSON) 추가
- 신규 테이블: `ai_sessions`, `command_logs`, `build_history`(room_id 포함)
- AI 시스템 계정(`__ai__`) 시딩, 로그인 시 사용자별 AI 채팅방 자동 생성

### 서버 (서비스 레이어 분리)
- `services/ollama.ts`: OpenAI 호환 스트리밍 채팅 + 모델 목록, 타임아웃/연결 오류 처리 (FR-29,30,33,34)
- `services/yona.ts`: 이슈 조회/생성, 필드 정규화 (FR-35~39)
- `services/jenkins.ts`: 빌드 실행/상태 조회, Basic 인증 (FR-40,43,45)
- 소켓 `ai:ask`/`ai:delta` 스트리밍, 컨텍스트 유지(FR-31), 응답 DB 저장(FR-32)
- 라우트: `/api/yona/*`, `/api/jenkins/*`(+웹훅 FR-42), `/api/integrations`
- 연동 실패/미설정 시 채팅 핵심 기능 무영향(서비스 분리) + 명확한 오류(502)
- `command_logs`로 명령어 실행 이력 기록(NFR 로그)

### 클라이언트
- 명령어 파서(`/ai`,`@ai`,`/issue`,`/issue create`,`/build`,`/build status`)
- AI 채팅방 전용 섹션/입력 처리 + 스트리밍 델타 실시간 표시(FR-30)
- 이슈/빌드 카드 렌더(`MessageItem`), 이슈 생성 모달, 빌드 실행 확인 모달(FR-44)
- 연동 활성화 정보(`/api/integrations`)로 비활성 기능 안내

### 검증 (헤드리스)
- 채팅 회귀(텍스트 실시간 송수신) 정상
- 로그인 시 AI 채팅방 자동 생성, 연동 미설정 시 모두 비활성 보고
- AI 미설정 시 오류 델타로 정상 종료, Yona/Jenkins 미설정 시 502
- command_logs 기록 확인
- 가짜 Ollama(OpenAI 호환 SSE) 서버로 스트리밍 delta 누적/DB 저장 정상 확인

### 기술 메모
- 외부 REST 호출은 추가 의존성 없이 내장 `fetch` 사용(명세의 axios 대체, 동일 목적)
- DB 스키마 CHECK/컬럼 변경은 기존 DB에 자동 반영되지 않으므로, 이후 `runMigrations()`로 처리

---

## 2026-07-03 오후 — 관리자 설정 UI, exe 배포, 마이그레이션 버그 수정

### 관리자 연동 설정 UI
**배경**: `.env` 파일 직접 편집 없이 UI에서 Ollama/Yona/Jenkins 설정 변경 필요

**구현**:
- `settings` DB 테이블 (key-value, env 폴백) + `getSettings()`/`updateSettings()`
- `GET/PUT /api/admin/settings` — 관리자 전용, 토큰은 `••••••••` 마스킹 응답
- 세 서비스가 정적 `config` 대신 `getSettings()` 호출 → **서버 재시작 없이 즉시 반영**
- `AdminSettingsModal` 컴포넌트: AI / Yona / Jenkins 탭
- `PublicUser.isAdmin` 추가, 관리자 로그인 시 사이드바 하단에 설정 버튼 노출

### exe 배포 빌드
**명령어**: `npm run package:win -w client`  
**산출물**: `client/release/Intra-Chat-0.1.0-portable.exe` (76 MB, 설치 불필요, x64)  
**수정 사항**:
- `client/package.json`: electron 버전 고정 (`^33.3.1` → `33.4.11`) — electron-builder 버전 감지 요구사항
- `electron-builder.yml`: 유효하지 않은 필드 제거, x64 명시, asar/compression 추가
- `client/.env`: 개발용 기본값 (localhost:3000)
- `client/.env.production.example`: 배포 시 서버 IP 설정 안내
- `client/build/README.md`: icon.ico 적용 방법 안내
- `.gitignore`: `client/build/` 추적 대상으로, 빌드 exe(`release/`)는 제외 유지

**배포 절차**:
1. `client/.env.production.example` → `client/.env.production` 복사 후 서버 IP 입력
2. `npm run package:win -w client` 실행 (macOS에서도 Windows exe 생성 가능)
3. `client/release/Intra-Chat-*.exe` 공유폴더 업로드

### 버그 수정: "Failed to fetch" — DB CHECK 제약 충돌
**원인**: `CREATE TABLE IF NOT EXISTS`는 이미 존재하는 테이블 스키마를 갱신하지 않음.  
구버전 DB의 `rooms.type CHECK('channel','group','dm')`에 `'ai'` 삽입 시 SqliteError 발생.

**수정**: `db/index.ts`에 `runMigrations()` 추가 — 서버 시작 시 자동 실행  
- sqlite_master에서 실제 CREATE 문을 조회해 마이그레이션 필요 여부 판단 (멱등 보장)
- `rooms`: `'ai'` 타입 추가 (12-step 재생성)
- `messages`: `'ai_response'`·`'card'` 타입 + `metadata TEXT` 컬럼 추가 (12-step 재생성)

### 테스트 계정
| 아이디 | 비밀번호 | 비고 |
|---|---|---|
| `admin` | `admin1234` | 관리자 (`ADMIN_USERNAMES=admin`) — 설정 버튼 노출 |
| `testuser` | `test1234` | 일반 사용자 |

### 커밋 이력 (이번 세션)
| 해시 | 내용 |
|---|---|
| `8536442` | feat: Intra-Chat PoC 초기 구현 |
| `851665b` | feat: v3 업무 연동 기능 추가 (AI/Yona/Jenkins) |
| `f100e0d` | fix: 카드/AI 응답 발신자를 명령 실행 사용자로 변경 |
| `54dfa62` | feat: 관리자 연동 설정 UI 추가 |
| `65ccbfa` | build: Windows portable exe 빌드 설정 완성 |
| `77354c8` | fix: 기존 DB 스키마 자동 마이그레이션 추가 |
