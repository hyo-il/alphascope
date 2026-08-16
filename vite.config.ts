import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// API 서버(Express)는 4000 포트. 브라우저는 /api 로만 호출하고,
// 토스/Claude API 키는 서버에만 존재한다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    watch: {
      // 파이썬 가상환경은 파일이 수만 개다. 감시하면 불필요한 리로드가 계속 발생한다.
      ignored: ['**/python/.venv/**', '**/db/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
