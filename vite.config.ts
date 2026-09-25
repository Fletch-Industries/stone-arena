import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { port: 5173, proxy: { '/arena-api': { target: 'http://127.0.0.1:3107', ws: true, rewrite: p => p.replace(/^\/arena-api/, '') } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 700 }
});
