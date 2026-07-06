@echo off
cd /d "%~dp0app"
"%~dp0node.exe" "dist\create-user.js" %*
if errorlevel 1 pause
