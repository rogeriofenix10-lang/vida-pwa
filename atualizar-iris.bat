@echo off
setlocal
cd /d "%~dp0"
echo Iris 5.5 - atualizacao local
if not exist package.json (echo package.json ausente. Execute na pasta raiz.& pause & exit /b 1)
if exist .env (echo ATENCAO: .env detectado; nao sera incluido em backups ou enviado.)
call pnpm install --prod=false --ignore-scripts
if errorlevel 1 (echo Falha nas dependencias.& pause & exit /b 1)
call pnpm exec tsc --noEmit --ignoreDeprecations 5.0
if errorlevel 1 (echo TypeScript falhou; atualizacao interrompida.& pause & exit /b 1)
echo Atualizacao validada. Os dados do navegador permanecem no dispositivo.
pause
