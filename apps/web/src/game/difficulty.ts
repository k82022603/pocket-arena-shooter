import type Phaser from 'phaser';
import { DIFFICULTY_ORDER, type Difficulty } from '../sim/difficulty';

const KEY = 'arena.difficulty';

// 혼자 하기 난이도. 무기 선택과 같이 세션(registry)과 기기(localStorage)에 남긴다.
export function selectedDifficulty(scene: Phaser.Scene): Difficulty {
  const fromRegistry = scene.registry.get(KEY) as Difficulty | undefined;
  if (fromRegistry && DIFFICULTY_ORDER.includes(fromRegistry)) return fromRegistry; // 이번 세션에 고른 값
  try {
    const stored = localStorage.getItem(KEY) as Difficulty | null;
    if (stored && DIFFICULTY_ORDER.includes(stored)) return stored; // 지난번 값 (모르는 값이면 무시)
  } catch {
    /* 저장 불가 환경 */
  }
  return 'normal'; // 처음이면 중
}

export function setDifficulty(scene: Phaser.Scene, difficulty: Difficulty): void {
  scene.registry.set(KEY, difficulty);
  try {
    localStorage.setItem(KEY, difficulty);
  } catch {
    /* 저장 불가 환경 */
  }
}
