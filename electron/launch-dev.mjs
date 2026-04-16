import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const electronBinary = path.join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

const child = spawn(electronBinary, ['.'], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    HERMES_ELECTRON_DEV: '1',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
