import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('hermesDesktop', {
  platform: 'electron',
  version: '0.1.0',
});
