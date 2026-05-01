import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(async () => {
  if (process.platform === 'win32' && !process.env.TAILWIND_DISABLE_OXIDE) {
    process.env.TAILWIND_DISABLE_OXIDE = '1';
  }
  const tailwindModuleName = '@tailwindcss/vite';
  const tailwindcss = (await import(tailwindModuleName)).default;

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      port: 3030, // Legacy standalone frontend mode only
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3020',
          changeOrigin: true,
        },
      },
    },
  };
});
