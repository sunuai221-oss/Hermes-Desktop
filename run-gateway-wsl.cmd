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
wsl.exe -d %HERMES_WSL_DISTRO% -e bash -lc "if [ -n \"$HERMES_WSL_HOME\" ]; then export HERMES_HOME=\"$HERMES_WSL_HOME\"; fi; export PORT=%HERMES_GATEWAY_PORT%; export PATH=\"$HOME/.local/bin:$PATH\"; exec hermes gateway run"
echo.
echo [Hermes Gateway] Process exited with code %ERRORLEVEL%.
pause
endlocal
