@echo off
cd /d "%~dp0"
if not exist .env (
 echo Copy .env.laptop.example to .env and fill the values described in docs/FREE-HOSTING.md.
 pause
 exit /b 1
)
if not exist node_modules (
 call npm ci
 if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
call npm run paper:laptop
pause
