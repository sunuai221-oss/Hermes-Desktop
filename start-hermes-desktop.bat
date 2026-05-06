@echo off
setlocal
title Hermes Desktop - Electron
color 05
echo ============================================
echo   Hermes Desktop : Electron
echo ============================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\hermes-desktop.local.cmd" (
  call "%ROOT%\hermes-desktop.local.cmd"
) else if exist "%ROOT%\hermes-builder.local.cmd" (
  call "%ROOT%\hermes-builder.local.cmd"
)
if not defined HERMES_WSL_DISTRO set "HERMES_WSL_DISTRO=Ubuntu"
if not defined HERMES_GATEWAY_PORT set "HERMES_GATEWAY_PORT=8642"
if not defined HERMES_DESKTOP_PORT set "HERMES_DESKTOP_PORT=3020"
set "GATEWAY_BASE_URL=http://127.0.0.1:%HERMES_GATEWAY_PORT%"
set "DESKTOP_PORT=%HERMES_DESKTOP_PORT%"
set "DESKTOP_HEALTH_URL=http://127.0.0.1:%DESKTOP_PORT%/api/desktop/health"
set "ELECTRON_CMD=%ROOT%\node_modules\.bin\electron.cmd"
set "ELECTRON_EXE=%ROOT%\node_modules\electron\dist\electron.exe"
set "ELECTRON_LINUX=%ROOT%\node_modules\electron\dist\electron"
set "SERVER_EXPRESS_PKG=%ROOT%\server\node_modules\express\package.json"
set "FRONTEND_INDEX=%ROOT%\dist\index.html"

echo [0/4] Checking desktop dependencies...
call :ensure_desktop_deps
if errorlevel 1 goto :missing_deps

echo [1/4] Checking Hermes Gateway...
call :check_gateway
if errorlevel 1 (
  echo      Gateway offline, starting WSL2...
  start "Hermes Gateway (WSL2)" cmd /k call "%ROOT%\run-gateway-wsl.cmd"
  call :wait_for_gateway 30
  if errorlevel 1 goto :error_gateway
) else (
  echo      Gateway already online.
)

if not exist "%FRONTEND_INDEX%" (
  echo [1.5/4] Frontend bundle missing, building now...
  pushd "%ROOT%"
  call npm.cmd run build
  if errorlevel 1 (
    popd
    goto :error_build
  )
  popd
)

echo [2/4] Launching Hermes Desktop on port %DESKTOP_PORT%...
pushd "%ROOT%"
set "HERMES_DESKTOP_BACKEND_PORT=%DESKTOP_PORT%"
set "HERMES_BUILDER_PORT=%DESKTOP_PORT%"
set "PORT=%DESKTOP_PORT%"
call npm.cmd run desktop
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
echo [3/4] Hermes Desktop closed. Code=%EXIT_CODE%
echo [4/4] Expected health URL: %DESKTOP_HEALTH_URL%
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
if exist "%ELECTRON_CMD%" if exist "%ELECTRON_EXE%" if exist "%SERVER_EXPRESS_PKG%" exit /b 0
if exist "%ELECTRON_LINUX%" (
  echo      Dependencies detected, but Electron is the Linux/WSL version.
) else (
  echo      Windows Electron binary not found.
)
echo      Automatically installing Windows dependencies via npm install...
pushd "%ROOT%"
call npm.cmd install
set "INSTALL_EXIT=%ERRORLEVEL%"
if "%INSTALL_EXIT%"=="0" (
  call npm.cmd run install:server
  set "INSTALL_EXIT=%ERRORLEVEL%"
)
popd
if not "%INSTALL_EXIT%"=="0" exit /b 1
if exist "%ELECTRON_CMD%" if exist "%ELECTRON_EXE%" if exist "%SERVER_EXPRESS_PKG%" exit /b 0
exit /b 1

:check_gateway
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $base='%GATEWAY_BASE_URL%'; $port=%HERMES_GATEWAY_PORT%; $endpoints=@($base + '/health', $base + '/v1/health'); foreach($url in $endpoints){ try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3 | Out-Null; exit 0 } catch {} }; try { $client = New-Object System.Net.Sockets.TcpClient; $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null); if ($iar.AsyncWaitHandle.WaitOne(1500, $false) -and $client.Connected) { $client.EndConnect($iar); $client.Close(); exit 0 } $client.Close() } catch {}; exit 1"
exit /b %ERRORLEVEL%

:wait_for_gateway
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $base='%GATEWAY_BASE_URL%'; $port=%HERMES_GATEWAY_PORT%; $timeout=%~1; $endpoints=@($base + '/health', $base + '/v1/health'); for($i = 0; $i -lt $timeout; $i++) { foreach($url in $endpoints){ try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3 | Out-Null; exit 0 } catch {} }; try { $client = New-Object System.Net.Sockets.TcpClient; $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null); if ($iar.AsyncWaitHandle.WaitOne(1500, $false) -and $client.Connected) { $client.EndConnect($iar); $client.Close(); exit 0 } $client.Close() } catch {}; Start-Sleep -Seconds 1 }; exit 1"
exit /b %ERRORLEVEL%

:error_gateway
echo.
echo [ERROR] Hermes gateway is not responding at %GATEWAY_BASE_URL%.
pause
endlocal
exit /b 1

:error_build
echo.
echo [ERROR] Frontend build for Hermes Desktop failed.
pause
endlocal
exit /b 1
