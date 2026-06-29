@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "APP_NAME=Terra Nova / SIMURB NewCore"
set "APP_VERSION=v2.4.20 - TMPE Connectors Phases Priority 5m/u"
set "HOST=127.0.0.1"
if "%PORT%"=="" set "PORT=8123"
set "MAX_PORT_TRIES=30"
set "CACHE_BUST=%RANDOM%%RANDOM%"
set "LOG_FILE=%TEMP%\terranova-newcore-server-%PORT%.log"

cls
echo ============================================================
echo %APP_NAME% %APP_VERSION%
echo Inicializador Windows SEM CACHE
echo Pasta: %CD%
echo ============================================================
echo.

if not exist "index.html" (
  echo [ERRO] index.html nao encontrado. Extraia o ZIP e execute este .bat dentro da pasta raiz do jogo.
  pause
  exit /b 1
)
if not exist "src" (
  echo [ERRO] Pasta src\ nao encontrada. O ZIP pode estar incompleto.
  pause
  exit /b 1
)
if not exist "vendor" (
  echo [ERRO] Pasta vendor\ nao encontrada. O ZIP pode estar incompleto.
  pause
  exit /b 1
)
if not exist "tools\serve_no_cache.py" (
  echo [ERRO] tools\serve_no_cache.py nao encontrado. O ZIP pode estar incompleto.
  pause
  exit /b 1
)

set "PY_CMD="
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 -c "import http.server" >nul 2>nul
  if !ERRORLEVEL!==0 set "PY_CMD=py -3"
)
if not defined PY_CMD (
  where python >nul 2>nul
  if !ERRORLEVEL!==0 (
    python -c "import http.server" >nul 2>nul
    if !ERRORLEVEL!==0 set "PY_CMD=python"
  )
)
if not defined PY_CMD (
  where python3 >nul 2>nul
  if !ERRORLEVEL!==0 (
    python3 -c "import http.server" >nul 2>nul
    if !ERRORLEVEL!==0 set "PY_CMD=python3"
  )
)
if not defined PY_CMD (
  echo [ERRO] Python nao encontrado. Instale Python 3 e marque a opcao "Add Python to PATH".
  pause
  exit /b 1
)

set /a START_PORT=%PORT%
set /a TRY=0
:find_port
powershell -NoProfile -ExecutionPolicy Bypass -Command "exit ([int][bool](Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue))" >nul 2>nul
if %ERRORLEVEL%==1 (
  echo [AVISO] Porta %PORT% ocupada, provavelmente por servidor antigo. Tentando proxima porta...
  set /a TRY+=1
  if !TRY! GEQ %MAX_PORT_TRIES% (
    echo [ERRO] Portas %START_PORT%..%PORT% ocupadas. Feche servidores antigos ou rode: set PORT=8130 ^& iniciar-terra-nova-windows.bat
    pause
    exit /b 1
  )
  set /a PORT+=1
  goto find_port
)

set "URL=http://%HOST%:%PORT%/?cache=v2419-%CACHE_BUST%"
echo Servidor: %URL%
echo Python: %PY_CMD%
echo Log: %LOG_FILE%
echo.
echo IMPORTANTE: se uma aba em 8123 mostrar versao antiga, feche essa aba/servidor.
echo Use a URL acima, aberta automaticamente.
echo Para fechar o jogo: CTRL+C nesta janela.
echo.

start "" /B powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Milliseconds 900; Start-Process '%URL%'"
%PY_CMD% tools\serve_no_cache.py --host %HOST% --port %PORT% --root "%CD%" > "%LOG_FILE%" 2>&1

echo.
echo Servidor encerrado.
echo Se o jogo nao abriu, veja o log: %LOG_FILE%
pause
