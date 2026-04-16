@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%\server"
echo [Builder Backend] cwd=%CD%
node index.mjs %*
echo.
echo [Builder Backend] Process exited with code %ERRORLEVEL%.
pause
endlocal
