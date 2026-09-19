import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// `vite --mode https` 로 실행하면 자체 서명 인증서로 https 제공 (폰에서 카메라/Web Bluetooth 등 secure context 필요 시)
// VITE_BASE 를 주면 서브 경로(예: GitHub Pages의 /repo-name/)에 배포할 수 있다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  return {
    base,
    plugins: [
      ...(mode === 'https' ? [basicSsl()] : []),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/apple-touch-icon.png'],
        manifest: {
          name: 'Arena Shooter — Fatima',
          short_name: 'Arena',
          description: '파티마와 함께 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임, 비공개)',
          display: 'standalone',
          orientation: 'landscape',
          start_url: base,
          scope: base,
          background_color: '#0b0f1a',
          theme_color: '#0b0f1a',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
          navigateFallback: `${base}index.html`,
          // 시그널링 웹소켓/프록시 경로는 캐시하지 않는다
          navigateFallbackDenylist: [/\/ws/],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/ws': { target: 'ws://localhost:8787', ws: true },
      },
    },
    build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  };
});
