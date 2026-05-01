interface HermesDesktopApi {
  platform: 'electron';
  version: string;
}

declare global {
  interface Window {
    hermesDesktop?: HermesDesktopApi;
  }
}

export {};
