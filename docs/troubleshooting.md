# Troubleshooting

## Common startup issues

### Electron dependencies are missing on Windows

Symptoms:

- `electron.exe` is missing
- a launcher reports that the Linux or WSL Electron binary was detected

Fix:

```powershell
npm run setup
```

If the repository was synchronized from WSL to Windows, reinstall the Windows dependencies in the Windows mirror.

### The backend fails on a fresh clone

Symptoms:

- `Cannot find package 'express'`
- the backend exits immediately on startup

Fix:

```powershell
npm run install:server
```

Or run the full fresh-clone setup again:

```powershell
npm run setup
```

### The Hermes gateway does not start from Windows

Check these points:

- WSL is enabled and the target distribution is installed
- `HERMES_WSL_DISTRO` points to the correct distribution
- the Hermes CLI works inside WSL
- `HERMES_CLI_PATH` is correct if you use an explicit path

### You see `builder` in logs or environment variables

That is expected. Hermes Desktop keeps some historical `builder` names for backward compatibility. These names do not indicate a second product or a separate web application.

### You launched the browser scripts by mistake

Use:

- `start-hermes-desktop.bat` for normal use
- `start-hermes-desktop-dev.bat` for Electron development
