import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 모드: 웹은 5173, 허브는 8787. API/WS 는 프록시로 허브에 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
