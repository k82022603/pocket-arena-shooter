import type Phaser from 'phaser';
import type { CharacterId } from '../sim/characters';
import { LOADOUTS, isLoadoutWeapon, type WeaponKind } from '../sim/weapons';

const KEY = (id: CharacterId) => `arena.loadout.${id}`; // 파티마마다 따로 저장한다

// 파티마별로 고른 기본 무기. 세션(registry)과 기기(localStorage)에 남긴다.
export function selectedLoadout(scene: Phaser.Scene, id: CharacterId): WeaponKind {
  const options = LOADOUTS[id];
  const fromRegistry = scene.registry.get(KEY(id)) as WeaponKind | undefined;
  if (fromRegistry !== undefined && options.includes(fromRegistry)) return fromRegistry; // 이번 세션에 고른 것이 우선
  try {
    const stored = Number(localStorage.getItem(KEY(id)));
    if (options.includes(stored as WeaponKind)) return stored as WeaponKind; // 지난번에 이 기기에서 고른 것
  } catch {
    /* 저장 불가 환경 */
  }
  return options[0]!; // 처음이면 목록의 첫 무기
}

export function setLoadout(scene: Phaser.Scene, id: CharacterId, weapon: WeaponKind): void {
  if (!isLoadoutWeapon(weapon) || !LOADOUTS[id].includes(weapon)) return; // 이 파티마가 고를 수 없는 무기는 무시
  scene.registry.set(KEY(id), weapon);
  try {
    localStorage.setItem(KEY(id), String(weapon));
  } catch {
    /* 저장 불가 환경 */
  }
}
