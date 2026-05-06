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
REM Do NOT quote the -d distro argument — when cmd.exe cwd contains spaces,
REM wsl.exe receives literal quote characters and fails with DISTRO_NOT_FOUND.
wsl.exe -d %HERMES_WSL_DISTRO% -e bash -lc "if [ -n \"$HERMES_WSL_HOME\" ]; then export HERMES_HOME=\"$HERMES_WSL_HOME\"; else export HERMES_HOME=\"${HERMES_HOME:-$HOME/.hermes}\"; fi; export PORT=%HERMES_GATEWAY_PORT%; export PATH=\"$HOME/.local/bin:$PATH\"; cli=\"${HERMES_CLI_PATH:-hermes}\"; pidfile=\"$HERMES_HOME/gateway.pid\"; if [ -f \"$pidfile\" ]; then pid=$(grep -o '[0-9]\+' \"$pidfile\" | head -n 1); if [ -n \"$pid\" ] && kill -0 \"$pid\" 2>/dev/null; then echo \"[Hermes Gateway] Existing gateway already running with PID $pid.\"; exit 0; fi; echo \"[Hermes Gateway] Removing stale gateway.pid ($pid).\"; rm -f \"$pidfile\"; fi; exec \"$cli\" gateway run"
echo.
echo [Hermes Gateway] Process exited with code %ERRORLEVEL%.
pause
endlocal
