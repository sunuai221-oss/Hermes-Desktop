@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"
echo [Hermes Desktop UI] cwd=%CD%
echo [Hermes Desktop UI] Browser-only mode on http://localhost:3030
npm.cmd run dev:vite
echo.
echo [Hermes Desktop UI] Process exited with code %ERRORLEVEL%.
pause
endlocal
