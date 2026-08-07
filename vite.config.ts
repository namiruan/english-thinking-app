import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages(프로젝트 하위 경로)에서도 에셋이 로드되도록 상대 경로 사용
  base: './',
  server: {
    port: 5173,
  },
});
