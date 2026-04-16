import { readFileSync } from 'node:fs';
import { contextBridge } from 'electron';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const { version } = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));

contextBridge.exposeInMainWorld('hermesDesktop', {
  platform: 'electron',
  version,
});
