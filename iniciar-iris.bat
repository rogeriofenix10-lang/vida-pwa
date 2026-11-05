@echo off
setlocal
cd /d "%~dp0"
set NODE_ENV=development
set PORT=3000
call pnpm run demo
