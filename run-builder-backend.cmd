@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%\server"
echo [Hermes Desktop Backend] cwd=%CD%
node index.mjs %*
echo.
echo [Hermes Desktop Backend] Process exited with code %ERRORLEVEL%.
pause
endlocal
