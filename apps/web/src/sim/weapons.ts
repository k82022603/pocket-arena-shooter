// 0 라이플(기본), 1 산탄총, 2 레이저
export type WeaponKind = 0 | 1 | 2;

export interface WeaponSpec {
  name: string;
  // null이면 파티마 고유 연사 간격을 쓴다
  intervalTicks: number | null;
  pellets: number;
  // 산탄 전체 퍼짐 각(라디안)
  spreadRad: number;
  speed: number;
  ttl: number;
  damageMul: number;
  pierce: boolean;
  durationTicks: number;
  color: number;
}

export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  0: { name: '라이플', intervalTicks: null, pellets: 1, spreadRad: 0, speed: 900, ttl: 90, damageMul: 1, pierce: false, durationTicks: 0, color: 0xffe066 },
  1: { name: '산탄총', intervalTicks: 30, pellets: 5, spreadRad: 0.42, speed: 800, ttl: 26, damageMul: 0.7, pierce: false, durationTicks: 600, color: 0xffa040 },
  2: { name: '레이저', intervalTicks: 24, pellets: 1, spreadRad: 0, speed: 1400, ttl: 60, damageMul: 2, pierce: true, durationTicks: 600, color: 0x4cf0ff },
};

// 0 힐팩, 1 산탄총, 2 레이저, 3 속도 부스트
export type PickupKind = 0 | 1 | 2 | 3;

export const PICKUP_NAMES: Record<PickupKind, string> = { 0: '힐팩', 1: '산탄총', 2: '레이저', 3: '부스트' };
export const PICKUP_COLORS: Record<PickupKind, number> = { 0: 0x69f0ae, 1: 0xffa040, 2: 0x4cf0ff, 3: 0xffe066 };

export const PICKUP = {
  spawnIntervalTicks: 900,
  max: 3,
  radius: 14,
  heal: 30,
  boostTicks: 300,
  boostMul: 1.5,
  // 종류별 스폰 가중치 (힐팩, 산탄총, 레이저, 부스트)
  weights: [40, 25, 20, 15] as const,
} as const;

export function rollPickupKind(roll01: number): PickupKind {
  const total = PICKUP.weights.reduce((a, b) => a + b, 0);
  let r = roll01 * total;
  for (let i = 0; i < PICKUP.weights.length; i++) {
    r -= PICKUP.weights[i]!;
    if (r < 0) return i as PickupKind;
  }
  return 0;
}
