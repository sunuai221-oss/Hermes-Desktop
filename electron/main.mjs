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
const BUILDER_PORT = Number(process.env.HERMES_BUILDER_PORT || process.env.PORT || 3020);
const BUILDER_URL = `http://127.0.0.1:${BUILDER_PORT}`;
const HEALTH_URL = `${BUILDER_URL}/api/builder/health`;
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

async function isBuilderOnline() {
  try {
    const response = await fetch(HEALTH_URL, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBuilder(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isBuilderOnline()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function resolveServerEntry() {
  return path.join(APP_ROOT, 'server', 'index.mjs');
}

async function spawnBuilderBackend() {
  const serverEntry = resolveServerEntry();
  if (!(await canAccess(serverEntry))) {
    throw new Error(`Builder backend entry not found: ${serverEntry}`);
  }

  const args = [serverEntry];
  if (IS_DEV) args.push('--dev');

  const child = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HERMES_BUILDER_PORT: String(BUILDER_PORT),
      PORT: String(BUILDER_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[builder] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[builder:err] ${chunk}`));
  child.on('exit', (code, signal) => {
    log(`Builder backend exited (code=${code}, signal=${signal})`);
    if (backendProcess === child) {
      backendProcess = null;
      backendOwnedByElectron = false;
    }
  });

  backendProcess = child;
  backendOwnedByElectron = true;
}

async function ensureBuilderBackend() {
  if (await isBuilderOnline()) {
    log(`Reusing existing builder backend on ${BUILDER_URL}`);
    return;
  }

  log(`Starting local builder backend on ${BUILDER_URL}`);
  await spawnBuilderBackend();
  const healthy = await waitForBuilder();
  if (!healthy) {
    throw new Error(`Builder backend did not become healthy on ${HEALTH_URL}`);
  }
}

function getBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#1a120d' : '#fcf0e4';
}

async function createMainWindow() {
  await ensureBuilderBackend();

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: 'Hermes',
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

  await mainWindow.loadURL(BUILDER_URL);

  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdownBuilderBackend() {
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
  await shutdownBuilderBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await shutdownBuilderBackend();
});
