@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"
echo [Builder UI] cwd=%CD%
echo [Builder UI] Legacy frontend-only mode on http://localhost:3030
npm.cmd run dev:vite
echo.
echo [Builder UI] Process exited with code %ERRORLEVEL%.
pause
endlocal
