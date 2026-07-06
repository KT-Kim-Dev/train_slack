@echo off
cd /d "%~dp0app"
if not exist ".env" copy /Y ".env.example" ".env"
echo ========================================
echo   Intra-Chat Server
echo   Press Ctrl+C to stop
echo ========================================
"%~dp0node.exe" "dist\index.js"
if errorlevel 1 pause
