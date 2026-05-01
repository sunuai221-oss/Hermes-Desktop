import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFile as execFileCb } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const DISTRO = process.env.HERMES_WSL_DISTRO || 'Ubuntu';
const GATEWAY_PORT = Number(process.env.HERMES_GATEWAY_PORT || 8642);
const BACKEND_PORT = Number(process.env.HERMES_DESKTOP_BACKEND_PORT || process.env.HERMES_DESKTOP_PORT || 3130);

const gatewayBase = `http://127.0.0.1:${GATEWAY_PORT}`;
const backendHealthUrl = `http://127.0.0.1:${BACKEND_PORT}/api/desktop/health`;

const checks = [];

function pushCheck(name, ok, detail, action = '') {
  checks.push({ name, ok, detail, action });
}

export function normalizeWslListOutput(stdout) {
  return String(stdout || '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '');
}

export function parseWslDistrosFromOutput(stdout) {
  return normalizeWslListOutput(stdout)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

async function fetchJson(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function checkElectronBinary() {
  const electronCmd = path.join(ROOT, 'node_modules', '.bin', 'electron.cmd');
  const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electronLinux = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

  if (fs.existsSync(electronCmd) && fs.existsSync(electronExe)) {
    pushCheck('Electron Windows binary', true, 'electron.cmd and electron.exe detected');
    return;
  }

  if (fs.existsSync(electronLinux)) {
    pushCheck(
      'Electron Windows binary',
      false,
      'Linux/WSL Electron detected, Windows binary missing',
      'Run `npm install` from Windows in this repository.',
    );
    return;
  }

  pushCheck(
    'Electron Windows binary',
    false,
    'Electron dependency is missing',
    'Run `npm install` from Windows in this repository.',
  );
}

async function checkWslDistro() {
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], {
      cwd: ROOT,
      windowsHide: true,
    });
    const distros = parseWslDistrosFromOutput(stdout);
    const hasTarget = distros.some(name => name.toLowerCase() === DISTRO.toLowerCase());
    if (hasTarget) {
      pushCheck('WSL distro', true, `${DISTRO} detected`);
      return;
    }
    pushCheck(
      'WSL distro',
      false,
      `${DISTRO} is not listed in \`wsl -l -q\``,
      'Install or rename the distro, or set HERMES_WSL_DISTRO in your local launcher override.',
    );
  } catch (error) {
    pushCheck(
      'WSL distro',
      false,
      `Could not query WSL distros (${error.message})`,
      'Ensure WSL is installed and enabled on this Windows machine.',
    );
  }
}

async function checkGatewayHealth() {
  const endpoints = [`${gatewayBase}/health`, `${gatewayBase}/v1/health`];
  for (const endpoint of endpoints) {
    try {
      await fetchJson(endpoint);
      pushCheck('Gateway health', true, `Gateway reachable at ${endpoint}`);
      return;
    } catch {
      // try next endpoint
    }
  }

  pushCheck(
    'Gateway health',
    false,
    `Gateway is not reachable on ${gatewayBase}`,
    'Run `start-hermes-desktop.bat` or `run-gateway-wsl.cmd` to start the gateway.',
  );
}

async function checkDesktopBackend() {
  try {
    const payload = await fetchJson(backendHealthUrl);
    const distReady = payload?.frontend?.dist_ready === true;
    if (distReady) {
      pushCheck('Desktop backend', true, `Backend healthy on port ${BACKEND_PORT}`);
      return;
    }
    pushCheck(
      'Desktop backend',
      false,
      `Backend is running on port ${BACKEND_PORT}, but frontend dist is missing`,
      'Run `npm run build` before launching Electron.',
    );
  } catch (error) {
    pushCheck(
      'Desktop backend',
      false,
      `Backend health endpoint unavailable (${error.message})`,
      'Launch with `start-hermes-desktop.bat` to start backend and Electron together.',
    );
  }
}

function printReport() {
  console.log('Hermes Desktop smoke report');
  console.log(`Root: ${ROOT}`);
  console.log(`Gateway: ${gatewayBase}`);
  console.log(`Backend health: ${backendHealthUrl}`);
  console.log('');

  for (const check of checks) {
    const mark = check.ok ? '[OK] ' : '[FAIL]';
    console.log(`${mark} ${check.name}: ${check.detail}`);
    if (!check.ok && check.action) {
      console.log(`       Action: ${check.action}`);
    }
  }

  console.log('');
}

async function main() {
  await checkElectronBinary();
  await checkWslDistro();
  await checkGatewayHealth();
  await checkDesktopBackend();
  printReport();

  const hasFailure = checks.some(check => !check.ok);
  process.exit(hasFailure ? 1 : 0);
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;

if (isMainModule) {
  await main();
}
