/// <reference types="vite/client" />

// 개발 서버가 알려주는 이 PC의 LAN 주소 (프로덕션 빌드에서는 null)
declare const __LAN_ORIGIN__: string | null;

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_BASE?: string;
}
