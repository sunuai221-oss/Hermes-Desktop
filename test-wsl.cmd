@echo off
setlocal
echo CWD=[%CD%]
echo --- Test 1: absolute path, no quotes on distro ---
%SystemRoot%\System32\wsl.exe -d Ubuntu -e bash -lc "echo TEST1_OK"
echo Exit: %ERRORLEVEL%
echo --- Test 2: absolute path, quoted distro ---
"%SystemRoot%\System32\wsl.exe" -d "Ubuntu" -e bash -lc "echo TEST2_OK"
echo Exit: %ERRORLEVEL%
echo --- Test 3: bare wsl.exe, no quotes ---
wsl.exe -d Ubuntu -e bash -lc "echo TEST3_OK"
echo Exit: %ERRORLEVEL%
echo --- Test 4: bare wsl.exe, quoted distro ---
wsl.exe -d "Ubuntu" -e bash -lc "echo TEST4_OK"
echo Exit: %ERRORLEVEL%
endlocal
