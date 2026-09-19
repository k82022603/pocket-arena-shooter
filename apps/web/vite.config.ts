import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { lanIPv4 } from '../../scripts/lan-ip.mjs';

const PORT = 5173; // 개발 서버 포트

// `vite --mode https` 로 실행하면 자체 서명 인증서로 https 제공 (폰에서 카메라/Web Bluetooth 등 secure context 필요 시)
// VITE_BASE 를 주면 서브 경로(예: GitHub Pages의 /repo-name/)에 배포할 수 있다.
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), ''); // .env 파일과 환경 변수를 읽는다
  const base = env.VITE_BASE || '/'; // 배포 경로 (기본은 사이트 루트)
  // localhost로 열어도 QR에는 폰이 닿을 수 있는 주소가 들어가도록 개발 서버의 LAN 주소를 알려준다
  const lanIp = command === 'serve' ? lanIPv4() : null;
  const lanOrigin = lanIp ? `${mode === 'https' ? 'https' : 'http'}://${lanIp}:${PORT}` : null;
  return {
    base,
    define: { __LAN_ORIGIN__: JSON.stringify(lanOrigin) }, // 코드 안의 __LAN_ORIGIN__을 이 값으로 바꿔 넣는다 (pairing.ts)
    plugins: [
      ...(mode === 'https' ? [basicSsl()] : []), // https 모드일 때만 자체 서명 인증서
      VitePWA({
        registerType: 'autoUpdate', // 새 버전이 배포되면 다음 방문 때 자동으로 바뀐다
        includeAssets: ['icons/apple-touch-icon.png'],
        manifest: {
          name: 'Arena Shooter — Fatima',
          short_name: 'Arena',
          description: '파티마와 함께 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임, 비공개)',
          display: 'standalone',
          orientation: 'landscape', // 설치 앱은 가로로 연다
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
          globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'], // 오프라인에서도 열리도록 미리 캐시할 파일
          navigateFallback: `${base}index.html`,
          // 시그널링 웹소켓/프록시 경로는 캐시하지 않는다
          navigateFallbackDenylist: [/\/ws/],
        },
        devOptions: { enabled: false }, // 개발 서버에서는 서비스워커를 쓰지 않는다 (캐시가 수정을 가리지 않게)
      }),
    ],
    server: {
      host: true, // 0.0.0.0에서 받는다: 같은 Wi‑Fi의 폰이 접속할 수 있게
      port: PORT,
      proxy: {
        '/ws': { target: 'ws://localhost:8787', ws: true }, // 페이지와 같은 주소의 /ws를 시그널링 서버로 넘긴다 (포트 하나만 열면 된다)
      },
    },
    build: { target: 'es2022', chunkSizeWarningLimit: 1600 }, // Phaser가 커서 경고 한도를 올려 둔다
  };
});
