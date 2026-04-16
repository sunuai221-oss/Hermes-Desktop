import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const APP_ICON = path.join(APP_ROOT, 'build', 'icons', 'icon-256.png');
const BACKEND_PORT = Number(process.env.HERMES_DESKTOP_BACKEND_PORT || process.env.HERMES_BUILDER_PORT || process.env.PORT || 3020);
const APP_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const HEALTH_URL = `${APP_URL}/api/desktop/health`;
const IS_DEV = process.env.HERMES_ELECTRON_DEV === '1';

let mainWindow = null;
let backendProcess = null;
let backendOwnedByElectron = false;

function log(...args) {
  console.log('[hermes-electron]', ...args);
}

async function canAccess(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isBackendOnline() {
  try {
    const response = await fetch(HEALTH_URL, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isBackendOnline()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function resolveServerEntry() {
  return path.join(APP_ROOT, 'server', 'index.mjs');
}

async function spawnBackend() {
  const serverEntry = resolveServerEntry();
  if (!(await canAccess(serverEntry))) {
    throw new Error(`Desktop backend entry not found: ${serverEntry}`);
  }

  const args = [serverEntry];
  if (IS_DEV) args.push('--dev');

  const child = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HERMES_DESKTOP_BACKEND_PORT: String(BACKEND_PORT),
      HERMES_BUILDER_PORT: String(BACKEND_PORT),
      PORT: String(BACKEND_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[desktop-backend] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[desktop-backend:err] ${chunk}`));
  child.on('exit', (code, signal) => {
    log(`Desktop backend exited (code=${code}, signal=${signal})`);
    if (backendProcess === child) {
      backendProcess = null;
      backendOwnedByElectron = false;
    }
  });

  backendProcess = child;
  backendOwnedByElectron = true;
}

async function ensureBackend() {
  if (await isBackendOnline()) {
    log(`Reusing existing backend on ${APP_URL}`);
    return;
  }

  log(`Starting local backend on ${APP_URL}`);
  await spawnBackend();
  const healthy = await waitForBackend();
  if (!healthy) {
    throw new Error(`Desktop backend did not become healthy on ${HEALTH_URL}`);
  }
}

function getBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#1a120d' : '#fcf0e4';
}

async function createMainWindow() {
  await ensureBackend();

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: 'Hermes Desktop',
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: getBackgroundColor(),
    webPreferences: {
      preload: path.join(APP_ROOT, 'electron', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Update background when OS theme changes
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(getBackgroundColor());
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(APP_URL);

  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdownBackend() {
  if (!backendOwnedByElectron || !backendProcess) return;
  const proc = backendProcess;
  backendProcess = null;
  backendOwnedByElectron = false;

  if (proc.exitCode != null || proc.killed) return;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 3000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    console.error('[hermes-electron] Failed to start:', error);
    app.quit();
    return;
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await shutdownBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await shutdownBackend();
});
