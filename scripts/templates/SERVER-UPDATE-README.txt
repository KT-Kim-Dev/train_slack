Intra-Chat 서버 업데이트 패키지 (Windows)
=========================================

기존에 운영 중인 서버의 **사용자·대화·업로드 파일·설정(.env)** 을 유지한 채
프로그램만 교체하는 패키지입니다.

## 포함 / 제외

  [교체] app\dist, app\node_modules, node.exe, start-server.bat 등
  [유지] app\data\ (SQLite DB)
         app\uploads\ (첨부 파일)
         app\logs\
         app\.env (서버 설정)
         app\RAG\ (RAG 문서, 있을 경우)

## 업데이트 절차

1. **서버 중지** — 실행 중인 start-server.bat 창을 닫거나 Ctrl+C
2. (권장) app\data, app\uploads, app\.env 를 다른 폴더에 백업
3. 이 ZIP을 임의 폴더에 압축 해제 (기존 서버 폴더 위에 덮어쓰지 마세요)
4. **update-server.bat** 실행:

     update-server.bat "D:\경로\Intra-Chat-Server-0.1.0-win"

   ※ 따옴표 안에 **기존 서버가 설치된 폴더** 경로를 넣습니다.

5. start-server.bat 으로 서버 재시작
6. 클라이언트 exe 도 새 버전으로 배포 (서버 IP 동일하면 .env 수정 불필요)

## .env 설정 추가 시

새 버전에서 .env.example 에 항목이 늘었을 수 있습니다.
기존 app\.env 는 자동으로 덮어쓰지 않으므로,
app\.env.example 과 비교해 필요한 변수만 수동으로 추가하세요.

## 최초 설치

처음 설치할 때는 update 패키지가 아니라
Intra-Chat-Server-{version}-win.zip (전체 패키지)를 사용하세요.
