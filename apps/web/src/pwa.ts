// PWA 설치 버튼. 브라우저가 "설치할 수 있다"고 알려 주는 이벤트를 붙잡아 두었다가 타이틀의 설치 버튼에서 쓴다.

// 표준 타입 정의에 아직 없는 Chrome 전용 이벤트
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null; // 보관해 둔 설치 요청 (null이면 설치 불가)
const listeners = new Set<() => void>(); // 설치 가능 여부가 바뀌면 알릴 곳 (타이틀의 설치 버튼)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // 브라우저 기본 설치 배너를 막고 우리 버튼으로 띄운다
  deferredPrompt = e as BeforeInstallPromptEvent;
  for (const fn of listeners) fn();
});

// 설치가 끝나면 버튼을 감춘다
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  for (const fn of listeners) fn();
});

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

// 이미 설치된 앱으로 실행 중인가 (홈 화면 아이콘으로 열었는가). iOS는 navigator.standalone으로 알린다
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt(); // 설치 확인 창을 띄운다 (보관한 요청은 한 번만 쓸 수 있다)
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

export function onInstallAvailabilityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
