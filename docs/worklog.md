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
