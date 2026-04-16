@echo off
setlocal
title Hermes Desktop - Browser Dev
color 05
echo ============================================
echo   Hermes Desktop : Browser Dev
echo ============================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\hermes-desktop.local.cmd" (
  call "%ROOT%\hermes-desktop.local.cmd"
) else if exist "%ROOT%\hermes-builder.local.cmd" (
  call "%ROOT%\hermes-builder.local.cmd"
)
if not defined HERMES_GATEWAY_PORT set "HERMES_GATEWAY_PORT=8642"
set "GATEWAY_HEALTH_URL=http://127.0.0.1:%HERMES_GATEWAY_PORT%/health"
set "DESKTOP_HEALTH_URL=http://127.0.0.1:3020/api/desktop/health"

echo [0/4] Cleaning old dev windows...
taskkill /F /FI "WINDOWTITLE eq Desktop Backend Dev*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Desktop Backend*" >nul 2>&1

echo [1/4] Starting Hermes Gateway (WSL2)...
call :check_url "%GATEWAY_HEALTH_URL%"
if errorlevel 1 (
  start "Hermes Gateway (WSL2)" cmd /k call "%ROOT%\run-gateway-wsl.cmd"
  call :wait_for_url "%GATEWAY_HEALTH_URL%" 30
  if errorlevel 1 goto :error_gateway
) else (
  echo      Gateway already online.
)

echo [2/4] Starting local backend + dev UI on 3020...
call :check_url "%DESKTOP_HEALTH_URL%"
if errorlevel 1 (
  start "Desktop Backend Dev" cmd /k call "%ROOT%\run-builder-backend.cmd" --dev
  call :wait_for_url "%DESKTOP_HEALTH_URL%" 30
  if errorlevel 1 goto :error_backend
) else (
  echo      Backend already online.
)

echo [3/4] Opening Hermes Desktop browser dev mode...
start "" "http://localhost:3020"

echo.
echo ============================================
echo   Dev mode ready! http://localhost:3020
echo ============================================
echo.
echo [4/4] Vite runs as middleware inside Express.
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

:error_backend
echo.
echo [ERROR] Desktop dev backend is not responding at %DESKTOP_HEALTH_URL%.
pause
exit /b 1
