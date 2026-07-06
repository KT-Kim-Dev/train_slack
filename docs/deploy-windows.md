# Windows 배포 가이드 (설치 불필요)

Node.js·Electron 등 **별도 설치 없이** Windows PC에 배포하는 방법입니다.

## 산출물 (각각 별도)

| 구분 | 명령 | 산출물 |
|---|---|---|
| **서버** | `npm run package:server:win` | `release/server/Intra-Chat-Server-{version}-win.zip` |
| **클라이언트** | `npm run package:client:win` | `client/release/Intra-Chat-{version}-portable.exe` |
| **둘 다** | `npm run package:win` | 위 두 가지 모두 생성 |

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
3. `create-user.bat` 실행 → 관리자 계정 생성
   ```bat
   create-user.bat --username admin --password admin1234 --name "관리자"
   ```
4. `start-server.bat` 실행
5. Windows 방화벽 **TCP 3000** 허용

포함 내용: `node.exe`(포터블 Node.js), 서버 프로그램, SQLite·업로드·로그 폴더

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
