@echo off
setlocal
title Hermes AI Builder - Runtime 3020
color 05
echo ============================================
echo   Hermes AI Builder : Standard Runtime
echo ============================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\hermes-builder.local.cmd" call "%ROOT%\hermes-builder.local.cmd"
if not defined HERMES_GATEWAY_PORT set "HERMES_GATEWAY_PORT=8642"
set "GATEWAY_HEALTH_URL=http://127.0.0.1:%HERMES_GATEWAY_PORT%/health"
set "BUILDER_HEALTH_URL=http://127.0.0.1:3020/api/builder/health"

:: 1. Clean dev mode only
echo [0/5] Cleaning dev windows...
taskkill /F /FI "WINDOWTITLE eq Builder UI*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Builder Backend Dev*" >nul 2>&1

:: 2. Hermes Gateway
echo [1/5] Checking Hermes Gateway...
call :check_url "%GATEWAY_HEALTH_URL%"
if errorlevel 1 (
  echo      Gateway offline, starting WSL2...
  start "Hermes Gateway (WSL2)" cmd /k call "%ROOT%\run-gateway-wsl.cmd"
  call :wait_for_url "%GATEWAY_HEALTH_URL%" 30 "Gateway Hermes"
  if errorlevel 1 goto :error_gateway
) else (
  echo      Gateway already online.
)

:: 3. Frontend build
echo [2/5] Building frontend bundle...
pushd "%ROOT%"
call npm.cmd run build
if errorlevel 1 goto :error_build
popd

:: 4. Builder Backend
echo [3/5] Checking Builder Backend...
call :check_url "%BUILDER_HEALTH_URL%"
if errorlevel 1 (
  echo      Backend offline, starting on 3020...
  start "Builder Backend" cmd /k call "%ROOT%\run-builder-backend.cmd"
  call :wait_for_url "%BUILDER_HEALTH_URL%" 30 "Builder Backend"
  if errorlevel 1 goto :error_backend
) else (
  echo      Backend already online.
)

:: 5. Open browser
echo [4/5] Opening Builder...
start "" "http://localhost:3020"

echo.
echo ============================================
echo   Everything is ready! http://localhost:3020
echo ============================================
echo.
echo [5/5] Dev mode is available via start-builder-dev.bat
pause
endlocal
goto :eof

:check_url
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing '%~1' -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"
exit /b %ERRORLEVEL%

:wait_for_url
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $url='%~1'; for($i = 0; $i -lt %~2; $i++) { try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
exit /b %ERRORLEVEL%

:error_gateway
echo.
echo [ERROR] Hermes gateway is not responding at %GATEWAY_HEALTH_URL%.
pause
exit /b 1

:error_build
popd
echo.
echo [ERROR] Frontend build failed.
pause
exit /b 1

:error_backend
echo.
echo [ERROR] Builder backend is not responding at %BUILDER_HEALTH_URL%.
pause
exit /b 1
