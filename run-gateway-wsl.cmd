@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\hermes-desktop.local.cmd" (
  call "%ROOT%\hermes-desktop.local.cmd"
) else if exist "%ROOT%\hermes-builder.local.cmd" (
  call "%ROOT%\hermes-builder.local.cmd"
)

if not defined HERMES_WSL_DISTRO set "HERMES_WSL_DISTRO=Ubuntu"
if not defined HERMES_GATEWAY_PORT set "HERMES_GATEWAY_PORT=8642"

echo [Hermes Gateway] Launching WSL gateway...
wsl.exe -d "%HERMES_WSL_DISTRO%" -e bash -lc "set -e; if [ -n \"$HERMES_WSL_HOME\" ]; then export HERMES_HOME=\"$HERMES_WSL_HOME\"; fi; HERMES_BIN=\"${HERMES_CLI_PATH:-$(command -v hermes || true)}\"; if [ -z \"$HERMES_BIN\" ] && [ -x \"$HOME/.local/bin/hermes\" ]; then HERMES_BIN=\"$HOME/.local/bin/hermes\"; fi; if [ -z \"$HERMES_BIN\" ]; then echo 'Hermes CLI not found in WSL' >&2; exit 127; fi; exec \"$HERMES_BIN\" gateway run --port %HERMES_GATEWAY_PORT%"
echo.
echo [Hermes Gateway] Process exited with code %ERRORLEVEL%.
pause
endlocal
