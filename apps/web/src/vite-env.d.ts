/// <reference types="vite/client" />

// 개발 서버가 알려주는 이 PC의 LAN 주소 (프로덕션 빌드에서는 null)
declare const __LAN_ORIGIN__: string | null;

// 빌드 때 넣을 수 있는 환경 변수 (import.meta.env로 읽는다)
interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string; // 호스팅된 시그널링 서버 주소 (예: wss://….onrender.com)
  readonly VITE_BASE?: string; // 서브 경로 배포 (예: /pocket-arena-shooter/)
}
