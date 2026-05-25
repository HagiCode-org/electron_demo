import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_HOST = '127.0.0.1';
const DEV_SERVER_PORT = 36598;

export default defineConfig({
  plugins: [react()],
  base: './',
  root: path.resolve(__dirname, './src/renderer'),
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    host: DEV_SERVER_HOST,
    port: DEV_SERVER_PORT,
    strictPort: true,
  },
});
