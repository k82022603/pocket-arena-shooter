import type Phaser from 'phaser';
import { DIFFICULTY_ORDER, type Difficulty } from '../sim/difficulty';

const KEY = 'arena.difficulty';

// 혼자 하기 난이도. 무기 선택과 같이 세션(registry)과 기기(localStorage)에 남긴다.
export function selectedDifficulty(scene: Phaser.Scene): Difficulty {
  const fromRegistry = scene.registry.get(KEY) as Difficulty | undefined;
  if (fromRegistry && DIFFICULTY_ORDER.includes(fromRegistry)) return fromRegistry;
  try {
    const stored = localStorage.getItem(KEY) as Difficulty | null;
    if (stored && DIFFICULTY_ORDER.includes(stored)) return stored;
  } catch {
    /* 저장 불가 환경 */
  }
  return 'normal';
}

export function setDifficulty(scene: Phaser.Scene, difficulty: Difficulty): void {
  scene.registry.set(KEY, difficulty);
  try {
    localStorage.setItem(KEY, difficulty);
  } catch {
    /* 저장 불가 환경 */
  }
}
