@echo off
set HERMES_WSL_DISTRO=Ubuntu
wsl.exe -d %HERMES_WSL_DISTRO% -e bash -lc "set -e; HERMES_BIN=\"${HERMES_CLI_PATH:-`command -v hermes 2^>/dev/null ^|^| true`}\"; echo OK"
