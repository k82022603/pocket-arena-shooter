import type Phaser from 'phaser';

const KEY = 'arena.aimAssist';

// 조준 보정 켜기/끄기. 기본은 켜짐. 무기 선택처럼 세션(registry)과 기기(localStorage)에 남긴다.
export function aimAssistOn(scene: Phaser.Scene): boolean {
  const fromRegistry = scene.registry.get(KEY) as boolean | undefined;
  if (fromRegistry !== undefined) return fromRegistry;
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAimAssist(scene: Phaser.Scene, on: boolean): void {
  scene.registry.set(KEY, on);
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* 저장 불가 환경 */
  }
}
