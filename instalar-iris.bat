@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Iris 5.5 - Instalador local
set "IRIS_DIR=%CD%"
set "PORT=3000"

echo ================================================
echo        IRIS 5.5 - INSTALACAO AUTOMATICA
echo ================================================
echo Pasta: %IRIS_DIR%
echo Modo: local/demonstracao - custo zero por padrao
echo.

for /f "tokens=*" %%a in ('powershell -NoProfile -Command "[math]::Round((Get-PSDrive -Name ((Get-Location).Path.Substring(0,1))).Free/1GB,2)"') do set "FREE_GB=%%a"
echo Espaco livre aproximado: %FREE_GB% GB

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo A porta %PORT% ja esta ocupada.
  choice /C SN /N /M "Encerrar o processo que usa a porta? [S/N]: "
  if errorlevel 2 goto :port_fail
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
)

set "IRIS_REPO_URL="
set /p "IRIS_REPO_URL=URL do repositorio oficial (Enter para usar esta pasta): "
if not "%IRIS_REPO_URL%"=="" (
  where git >nul 2>nul || (echo Git nao encontrado. Continuando com a pasta atual.& goto :after_clone)
  set "CLONE_DIR=%USERPROFILE%\Iris-source"
  if exist "!CLONE_DIR!" (echo Pasta !CLONE_DIR! ja existe. Continuando com a pasta atual.& goto :after_clone)
  echo Clonando repositorio oficial para !CLONE_DIR!...
  git clone "%IRIS_REPO_URL%" "!CLONE_DIR!"
  if errorlevel 1 (echo Falha na clonagem. Continuando com a pasta atual.& goto :after_clone)
  cd /d "!CLONE_DIR!"
  set "IRIS_DIR=!CLONE_DIR!"
)
:after_clone

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado.
  choice /C SN /N /M "Instalar Node.js LTS automaticamente? [S/N]: "
  if errorlevel 2 goto :node_missing
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Instalando Node.js LTS via winget...
    winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  ) else (
    where choco >nul 2>nul
    if not errorlevel 1 (
      echo Instalando Node.js LTS via Chocolatey...
      choco install nodejs-lts -y
    ) else (
      echo Nao encontrei winget nem Chocolatey.
      echo Instale Node.js LTS em https://nodejs.org/ e execute este arquivo novamente.
      goto :fail
    )
  )
  call refreshenv >nul 2>nul
  where node >nul 2>nul || goto :node_missing
)

for /f "tokens=*" %%v in ('node --version') do echo Node.js: %%v

where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado. Ele e opcional para o modo local.
  choice /C SN /N /M "Instalar Python automaticamente? [S/N]: "
  if errorlevel 2 goto :python_skip
  where winget >nul 2>nul
  if not errorlevel 1 winget install --id Python.Python.3.12 --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    where choco >nul 2>nul
    if not errorlevel 1 choco install python -y
  )
  call refreshenv >nul 2>nul
)
:python_skip
where python >nul 2>nul && (for /f "tokens=*" %%v in ('python --version') do echo %%v) || echo Python: opcional/nao instalado

corepack enable
if errorlevel 1 (
  echo Corepack indisponivel; tentando instalar pnpm via npm...
  call npm install -g pnpm@10.4.1
  if errorlevel 1 goto :fail
)
corepack prepare pnpm@10.4.1 --activate
if errorlevel 1 (
  echo Corepack nao conseguiu ativar pnpm; usando a instalacao global existente.
  where pnpm >nul 2>nul || call npm install -g pnpm@10.4.1
  if errorlevel 1 goto :fail
)
for /f "tokens=*" %%v in ('pnpm --version') do echo pnpm: %%v

echo.
echo Instalando dependencias da Iris...
pnpm install --prod=false --ignore-scripts
if errorlevel 1 goto :fail

echo.
echo Executando preflight de seguranca e custo zero...
pnpm run preflight:free
if errorlevel 1 goto :fail

echo.
echo Validando TypeScript...
pnpm exec tsc --noEmit --ignoreDeprecations 5.0
if errorlevel 1 goto :fail

echo.
echo Instalacao concluida com sucesso.
echo Iniciando a Iris na porta %PORT%...
set "NODE_ENV=development"
call pnpm run demo
exit /b %errorlevel%

:node_missing
echo Node.js continua indisponivel. Feche e abra o Prompt de Comando apos a instalacao e tente novamente.
goto :fail

:port_fail
echo A instalacao foi cancelada porque a porta %PORT% esta ocupada.
echo Execute parar-iris.bat ou altere PORT para 8080 e tente novamente.
goto :fail

:fail
echo.
echo INSTALACAO NAO CONCLUIDA.
echo Corrija a mensagem acima e execute instalar-iris.bat novamente.
pause
exit /b 1
