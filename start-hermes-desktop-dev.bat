@echo off
setlocal
title Hermes Desktop - Electron Dev
color 05
echo ============================================
echo   Hermes Desktop : Electron Dev
echo ============================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\hermes-builder.local.cmd" call "%ROOT%\hermes-builder.local.cmd"
if not defined HERMES_GATEWAY_PORT set "HERMES_GATEWAY_PORT=8642"
if not defined HERMES_DESKTOP_DEV_PORT set "HERMES_DESKTOP_DEV_PORT=3131"
set "GATEWAY_HEALTH_URL=http://127.0.0.1:%HERMES_GATEWAY_PORT%/health"
set "DESKTOP_PORT=%HERMES_DESKTOP_DEV_PORT%"
set "BUILDER_HEALTH_URL=http://127.0.0.1:%DESKTOP_PORT%/api/builder/health"
set "ELECTRON_CMD=%ROOT%\node_modules\.bin\electron.cmd"
set "ELECTRON_EXE=%ROOT%\node_modules\electron\dist\electron.exe"
set "ELECTRON_LINUX=%ROOT%\node_modules\electron\dist\electron"

echo [0/4] Checking desktop dependencies...
call :ensure_desktop_deps
if errorlevel 1 goto :missing_deps

echo [1/4] Checking Hermes Gateway...
call :check_url "%GATEWAY_HEALTH_URL%"
if errorlevel 1 (
  echo      Gateway offline, starting WSL2...
  start "Hermes Gateway (WSL2)" cmd /k call "%ROOT%\run-gateway-wsl.cmd"
  call :wait_for_url "%GATEWAY_HEALTH_URL%" 30
  if errorlevel 1 goto :error_gateway
) else (
  echo      Gateway already online.
)

echo [2/4] Launching Hermes Desktop Dev on port %DESKTOP_PORT%...
pushd "%ROOT%"
set "HERMES_BUILDER_PORT=%DESKTOP_PORT%"
set "PORT=%DESKTOP_PORT%"
call npm.cmd run desktop:dev
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
echo [3/4] Hermes Desktop Dev closed. Code=%EXIT_CODE%
echo [4/4] Expected health URL: %BUILDER_HEALTH_URL%
pause
endlocal
exit /b %EXIT_CODE%

:missing_deps
echo.
echo [ERROR] Missing Electron dependencies.
echo Run this first on Windows:
echo   cd /d "%ROOT%"
echo   npm install
echo.
echo Note: if this folder was synchronized from WSL, Electron must be reinstalled
echo with a Windows binary ^(electron.exe^).
pause
endlocal
exit /b 1

:ensure_desktop_deps
if exist "%ELECTRON_CMD%" if exist "%ELECTRON_EXE%" exit /b 0
if exist "%ELECTRON_LINUX%" (
  echo      Dependencies detected, but Electron is the Linux/WSL version.
) else (
  echo      Windows Electron binary not found.
)
echo      Automatically installing Windows dependencies via npm install...
pushd "%ROOT%"
call npm.cmd install
set "INSTALL_EXIT=%ERRORLEVEL%"
popd
if not "%INSTALL_EXIT%"=="0" exit /b 1
if exist "%ELECTRON_CMD%" if exist "%ELECTRON_EXE%" exit /b 0
exit /b 1

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
endlocal
exit /b 1
