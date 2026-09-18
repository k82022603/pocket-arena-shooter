import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `vite --mode https` 로 실행하면 자체 서명 인증서로 https 제공 (폰에서 카메라/Web Bluetooth 등 secure context 필요 시)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { target: 'es2022' },
}));
