Intra-Chat 서버 (Windows 배포판)
================================

설치 없이 이 폴더만 복사하면 동작합니다. Node.js 별도 설치 불필요.

## 빠른 시작

1. app\.env.example 을 app\.env 로 복사 후 JWT_SECRET 등 수정
   (start-server.bat 실행 시 .env 가 없으면 자동 복사됩니다)
2. start-server.bat 실행 → 서버 기동 (기본 포트 3000)
   → 최초 기동 시 기본 관리자 자동 생성: admin / admin1234
3. (선택) create-user.bat → 추가 계정 생성
4. Windows 방화벽에서 TCP 3000 포트 허용

## 폴더 구조

  node.exe          … 내장 Node.js 런타임 (설치 불필요)
  start-server.bat  … 서버 실행
  create-user.bat   … 사용자 계정 생성 CLI
  app\
    dist\           … 서버 프로그램
    data\           … SQLite DB (자동 생성)
    uploads\        … 업로드 파일
    logs\           … 실행 로그
    .env            … 서버 설정 (직접 생성)

## 추가 계정 생성 예시 (선택)

  create-user.bat --username user1 --password pass1234 --name "홍길동"

## 업데이트 (데이터 유지)

이미 운영 중인 서버를 **사용자·대화·업로드·.env 를 유지**한 채 프로그램만
올릴 때는 `Intra-Chat-Server-{version}-update-win.zip` 을 사용하세요.

1. start-server.bat 으로 실행 중인 서버 중지
2. (권장) app\data, app\uploads, app\.env 백업
3. update ZIP 을 **별도 폴더**에 압축 해제
4. update-server.bat "기존_서버_폴더_경로" 실행
5. start-server.bat 재시작

자세한 내용은 update ZIP 안 README.txt 참고.

## 클라이언트 연결

클라이언트 exe 빌드 시 서버 IP를 지정해야 합니다.
(예: http://192.168.1.100:3000)

관리자로 로그인 후 앱 내 [설정]에서 Ollama/Yona/Jenkins 연동도 설정할 수 있습니다.

## 상시 구동 (선택)

작업 스케줄러 또는 NSSM으로 start-server.bat 을 등록하세요.
