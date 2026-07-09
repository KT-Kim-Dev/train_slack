# Windows 배포 가이드 (설치 불필요)

Node.js·Electron 등 **별도 설치 없이** Windows PC에 배포하는 방법입니다.

## 산출물 (각각 별도)

| 구분 | 명령 | 산출물 |
|---|---|---|
| **서버 (최초 설치)** | `npm run package:server:win` | `release/server/Intra-Chat-Server-{version}-win.zip` |
| **서버 (업데이트)** | `npm run package:server:win` | `release/server/Intra-Chat-Server-{version}-update-win.zip` |
| **클라이언트** | `npm run package:client:win` | `client/release/Intra-Chat-{version}-portable.exe` |
| **둘 다** | `npm run package:win` | 위 세 가지 모두 생성 |

> 패키징은 **인터넷 연결 가능한 빌드 PC**(macOS/Windows 모두 가능)에서 실행합니다.
> 완성된 zip/exe 만 USB·공유폴더로 사내 Windows PC에 반입하면 됩니다.

---

## 1. 서버 배포

### 빌드 (개발 PC)

```bash
npm install
npm run package:server:win
```

### 사내 Windows 서버 PC에 설치

1. `release/server/Intra-Chat-Server-0.1.0-win.zip` 압축 해제
2. `app\.env.example` → `app\.env` 복사 후 `JWT_SECRET` 변경
3. `start-server.bat` 실행
4. 클라이언트에서 **admin / admin1234** 로 로그인 (최초 기동 시 자동 생성)
5. Windows 방화벽 **TCP 3000** 허용

포함 내용: `node.exe`(포터블 Node.js), 서버 프로그램, SQLite·업로드·로그 폴더

---

## 1-1. 서버 업데이트 (데이터 유지)

기존 사용자·대화·첨부파일·`.env` 설정을 **그대로 두고** 프로그램만 교체합니다.

### 빌드 (개발 PC)

```bash
npm run package:server:win
```

→ `release/server/Intra-Chat-Server-{version}-update-win.zip` 이 함께 생성됩니다.

### 사내 Windows 서버 PC에서 적용

1. **서버 중지** — `start-server.bat` 창 종료 (Ctrl+C)
2. (권장) `app\data`, `app\uploads`, `app\.env` 백업
3. update ZIP을 **임시 폴더**에 압축 해제 (기존 서버 폴더에 덮어쓰지 않음)
4. `update-server.bat` 실행:

   ```bat
   update-server.bat "D:\Intra-Chat\Intra-Chat-Server-0.1.0-win"
   ```

   따옴표 안에 **기존 서버가 설치된 폴더** 경로를 넣습니다.

5. `start-server.bat` 으로 재시작

| 구분 | 업데이트 시 동작 |
|---|---|
| **교체** | `app\dist`, `app\node_modules`, `node.exe`, bat 스크립트 |
| **유지** | `app\data\` (DB), `app\uploads\`, `app\logs\`, `app\.env`, `app\RAG\` |

> 새 버전에서 `.env` 항목이 추가되면 `app\.env.example`과 비교해 수동 반영하세요.
> DB 스키마는 서버 기동 시 자동 마이그레이션됩니다.

---

## 2. 클라이언트 배포

### 빌드 전 — 서버 IP 설정 (필수)

```bash
cp client/.env.production.example client/.env.production
# VITE_SERVER_URL=http://192.168.155.89:3000  ← 실제 서버 IP로 수정
```

### 빌드

```bash
npm run package:client:win
```

### 사용자 PC에 배포

- `client/release/Intra-Chat-0.1.0-portable.exe` 를 공유폴더에 업로드
- 각 사용자가 다운로드 후 실행 (설치 불필요)

---

## 3. 최초 연동 확인

1. 서버 PC: `start-server.bat` 실행
2. 클라이언트 PC: exe 실행 → 로그인
3. 관리자 계정: 사이드바 **설정** → Ollama/Yona/Jenkins URL 입력

---

## 상시 구동 (서버, 선택)

- **작업 스케줄러**: 로그온 시 `start-server.bat` 실행 등록
- **NSSM**: Windows 서비스로 등록

---

## 오프라인 반입

인터넷 없는 PC에서 패키징할 수 없으므로, 인터넷 가능 PC에서 zip/exe 를 만든 뒤 USB로 반입하세요.
