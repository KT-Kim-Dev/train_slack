# Intra-Chat

사내 인트라넷(외부망 차단) 환경에서 동작하는 Slack형 실시간 채팅 프로그램 PoC.
서버(Node.js + Express + Socket.IO + SQLite)와 데스크톱 클라이언트(Electron + React)로 구성되며,
모두 TypeScript 로 작성되었습니다.

## 주요 기능

- 관리자 발급 ID/PW 로그인 (JWT 인증, bcrypt 해시)
- 공개 채널 / 비공개 그룹채팅 / 1:1 DM
- 실시간 텍스트 메시지 (Socket.IO) + 히스토리 스크롤 페이지네이션
- 파일/이미지 첨부 (드래그앤드롭, 다중 첨부, 업로드 진행률, 이미지 미리보기, 다운로드)
- 온라인/오프라인 상태 표시, 미읽음 배지
- 자동 로그인, Socket 자동 재연결

## 프로젝트 구조

```
train_slack/
  shared/   # 서버-클라이언트 공통 TypeScript 타입
  server/   # Express + Socket.IO + SQLite 백엔드
  client/   # Electron + React 데스크톱 앱
  docs/     # 개발 작업 로그(worklog.md)
  logs/     # 런타임 로그(winston, gitignore)
```

## 요구 사항

- Node.js 18 이상 (개발 검증: Node 24)
- Windows 10 이상 (클라이언트 실행 대상)

## 개발 환경 실행

### 1. 의존성 설치

```bash
npm install
```

> 이 저장소는 네이티브 의존성으로 `better-sqlite3`(사전 빌드 바이너리 사용)를 사용합니다.
> 일부 보안 설정된 npm 환경에서는 설치 스크립트 승인이 필요할 수 있습니다.

### 2. 관리자/사용자 계정 발급 (FR-01)

```bash
# 대화형
npm run server:create-user

# 인자 지정
npm run create-user -w server -- --username admin --password admin1234 --name "관리자 경태"
```

- `.env` 의 `ADMIN_USERNAMES` 에 포함된 아이디(기본 `admin`)는 관리자 API 사용 권한을 가집니다.

### 3. 서버 실행

```bash
npm run server:dev     # 개발(watch) 모드, 기본 포트 3000
```

서버 설정은 `server/.env` 로 조정합니다 (`server/.env.example` 참고).

### 4. 클라이언트 실행

```bash
npm run client:dev     # Electron 앱 실행 (Vite dev 서버 + 렌더러 핫리로드)
```

로그인 화면에서 발급받은 계정으로 접속하면 기본 공개 채널 `general` 에 자동 합류합니다.
2개 이상 실행(또는 2대 PC)하여 서로 다른 계정으로 로그인하면 실시간 송수신을 확인할 수 있습니다.

## 관리자 계정 관리 (FR-04)

관리자 계정으로 로그인한 클라이언트의 토큰으로 아래 REST API를 호출하거나, CLI 로 계정을 발급합니다.

- `POST /api/admin/users` : 계정 생성
- `POST /api/admin/users/:id/deactivate` : 비활성화 (해당 사용자 세션 즉시 종료)
- `POST /api/admin/users/:id/activate` : 활성화
- `DELETE /api/admin/users/:id` : 삭제 (세션 즉시 종료)

## Windows 클라이언트 패키징 (FR: 배포)

```bash
npm run client:build          # 렌더러/메인/프리로드 번들링
npm run package:win -w client # electron-builder 로 portable exe 생성 (client/release/)
```

- 산출물: `client/release/Intra-Chat-<version>-portable.exe`
- 이 exe 를 사내 공유폴더에 업로드하여 각 사용자가 다운로드/실행합니다.
- 배포 클라이언트가 접속할 서버 주소는 빌드 시 `VITE_SERVER_URL` 환경변수로 지정합니다.
  예: `VITE_SERVER_URL=http://192.168.0.10:3000 npm run package:win -w client`

## 오프라인(인터넷 미연결) 반입 가이드

인트라넷 서버/빌드 PC는 인터넷이 없으므로, 인터넷 가능한 PC에서 다음을 미리 확보해 반입합니다.

1. **Node.js 설치파일(.msi)**: 서버/빌드 PC에 동일 LTS 버전 설치.
2. **의존성 반입**: 인터넷 가능 PC에서 프로젝트 루트 기준 `npm install` 실행 후,
   생성된 `node_modules` 전체와 `package-lock.json` 을 함께 압축하여 반입, 동일 경로에 해제.
   - `better-sqlite3` 는 대상 OS/Node 버전에 맞는 사전 빌드 바이너리가 포함되어야 하므로,
     반드시 **서버와 동일한 OS(Windows)** 에서 받은 `node_modules` 를 사용합니다.
3. **Electron 캐시**: `client` 빌드 시 electron 바이너리가 필요합니다.
   인터넷 가능 PC에서 한 번 `npm install` 하여 받은 electron 캐시가 `node_modules/electron` 에 포함됩니다.

## 서버 상시 구동 (운영)

- PM2: `pm2 start "npm run start" --name intra-chat -w server`
- 또는 NSSM 등으로 Windows 서비스 등록.

## 로그

- 런타임 로그: `logs/app.log`, `logs/error.log` (winston)
- 개발 작업 로그: `docs/worklog.md`

## 데이터 백업

- SQLite 파일(`server/data/intra-chat.sqlite`)과 업로드 폴더(`server/uploads/`)를 주기적으로 복사 백업.
