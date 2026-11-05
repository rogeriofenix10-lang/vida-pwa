@echo off
setlocal
cd /d "%~dp0"
echo === IRIS DIAGNOSTICO LOCAL ===
echo Pasta: %CD%
node --version
pnpm --version
if exist package.json (findstr /C:"\"version\"" package.json) else echo package.json ausente
if exist client\public\manifest.webmanifest (echo PWA: manifesto encontrado) else echo PWA: manifesto ausente
if exist scripts\iris-demo.sh (echo Demo: script encontrado) else echo Demo: script ausente
echo.
diskpart /s nul 2>nul || echo Verifique o espaco livre do disco no Explorador.
pause
