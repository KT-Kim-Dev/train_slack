@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

REM ============================================================
REM  Intra-Chat 서버 업데이트 (데이터 유지)
REM  - 교체: dist, node_modules, node.exe, 실행 스크립트
REM  - 유지: app\data, app\uploads, app\logs, app\.env, app\RAG
REM ============================================================

set "UPDATE_ROOT=%~dp0"
set "TARGET=%~1"

if "%TARGET%"=="" (
  echo.
  echo  사용법: update-server.bat "기존_서버_폴더_경로"
  echo.
  echo  예: update-server.bat "D:\Intra-Chat\Intra-Chat-Server-0.1.0-win"
  echo.
  echo  ※ 업데이트 전 start-server.bat 창을 닫아 서버를 중지하세요.
  echo  ※ DB/업로드/.env 는 건드리지 않습니다.
  echo.
  pause
  exit /b 1
)

REM 경로 끝 백슬래시 제거
if "%TARGET:~-1%"=="\" set "TARGET=%TARGET:~0,-1%"

if not exist "%TARGET%\app\" (
  echo [오류] 대상 폴더에 app\ 이 없습니다: %TARGET%
  pause
  exit /b 1
)

if not exist "%UPDATE_ROOT%app\dist\index.js" (
  echo [오류] 업데이트 패키지가 손상되었습니다. app\dist\index.js 가 없습니다.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Intra-Chat 서버 업데이트
echo ========================================
echo   대상: %TARGET%
echo.
echo   [교체] app\dist, app\node_modules, node.exe, bat
echo   [유지] app\data, app\uploads, app\logs, app\.env, app\RAG
echo.

set /p CONFIRM=계속하시겠습니까? (Y/N): 
if /I not "%CONFIRM%"=="Y" (
  echo 취소되었습니다.
  exit /b 0
)

echo.
echo [1/4] 프로그램 dist 교체…
robocopy "%UPDATE_ROOT%app\dist" "%TARGET%\app\dist" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [오류] dist 복사 실패
  pause
  exit /b 1
)

echo [2/4] node_modules 교체…
robocopy "%UPDATE_ROOT%app\node_modules" "%TARGET%\app\node_modules" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [오류] node_modules 복사 실패
  pause
  exit /b 1
)

echo [3/4] node.exe 및 실행 스크립트 교체…
copy /Y "%UPDATE_ROOT%node.exe" "%TARGET%\node.exe" >nul
copy /Y "%UPDATE_ROOT%start-server.bat" "%TARGET%\start-server.bat" >nul
copy /Y "%UPDATE_ROOT%create-user.bat" "%TARGET%\create-user.bat" >nul
copy /Y "%UPDATE_ROOT%README.txt" "%TARGET%\README.txt" >nul
if exist "%UPDATE_ROOT%VERSION.txt" copy /Y "%UPDATE_ROOT%VERSION.txt" "%TARGET%\VERSION.txt" >nul

echo [4/4] .env.example 참고용 갱신 (기존 .env 는 유지)…
copy /Y "%UPDATE_ROOT%app\.env.example" "%TARGET%\app\.env.example" >nul

echo.
echo ========================================
echo   업데이트 완료
echo ========================================
echo   start-server.bat 으로 서버를 다시 실행하세요.
echo.
echo   ※ 새 버전에 .env 설정 항목이 추가된 경우
echo      app\.env.example 과 app\.env 를 비교해 필요한 값만 수동 추가하세요.
echo.
pause
exit /b 0
