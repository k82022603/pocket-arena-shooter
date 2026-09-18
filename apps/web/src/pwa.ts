interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  for (const fn of listeners) fn();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  for (const fn of listeners) fn();
});

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

export function onInstallAvailabilityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
