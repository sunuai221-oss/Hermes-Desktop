@echo off
setlocal
title Hermes AI Builder - Dev 3020
color 05
echo ============================================
echo   Hermes AI Builder : Dev Mode
echo ============================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\hermes-builder.local.cmd" call "%ROOT%\hermes-builder.local.cmd"
if not defined HERMES_GATEWAY_PORT set "HERMES_GATEWAY_PORT=8642"
set "GATEWAY_HEALTH_URL=http://127.0.0.1:%HERMES_GATEWAY_PORT%/health"
set "BUILDER_HEALTH_URL=http://127.0.0.1:3020/api/builder/health"

echo [0/4] Cleaning old dev windows...
taskkill /F /FI "WINDOWTITLE eq Builder Backend Dev*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Builder Backend*" >nul 2>&1

echo [1/4] Starting Hermes Gateway (WSL2)...
call :check_url "%GATEWAY_HEALTH_URL%"
if errorlevel 1 (
  start "Hermes Gateway (WSL2)" cmd /k call "%ROOT%\run-gateway-wsl.cmd"
  call :wait_for_url "%GATEWAY_HEALTH_URL%" 30
  if errorlevel 1 goto :error_gateway
) else (
  echo      Gateway already online.
)

echo [2/4] Starting Builder Backend + dev UI on 3020...
call :check_url "%BUILDER_HEALTH_URL%"
if errorlevel 1 (
  start "Builder Backend Dev" cmd /k call "%ROOT%\run-builder-backend.cmd" --dev
  call :wait_for_url "%BUILDER_HEALTH_URL%" 30
  if errorlevel 1 goto :error_backend
) else (
  echo      Backend already online.
)

echo [3/4] Opening Builder dev...
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
echo [ERROR] Builder dev backend is not responding at %BUILDER_HEALTH_URL%.
pause
exit /b 1
