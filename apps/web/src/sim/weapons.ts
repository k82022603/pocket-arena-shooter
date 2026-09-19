import type { CharacterId } from './characters';

// 무기와 픽업 정의. 수치는 모두 여기서만 바꾼다.

// 0 라이플, 1 산탄총(픽업), 2 레이저(픽업), 3 기관총, 4 장총, 5 산탄(기본 무기판)
export type WeaponKind = 0 | 1 | 2 | 3 | 4 | 5;

export interface WeaponSpec {
  name: string;
  // 절대 연사 간격(픽업용). null이면 파티마 고유 간격 × intervalMul
  intervalTicks: number | null;
  intervalMul: number; // 파티마 연사 간격에 곱하는 배율 (작을수록 빨리 쏜다)
  pellets: number; // 한 번에 나가는 탄알 수
  // 산탄 전체 퍼짐 각(라디안)
  spreadRad: number;
  // 매 발 무작위 흔들림(라디안, spawnTick에서 결정적으로 유도)
  jitterRad: number;
  speed: number; // 탄속 (px/s)
  ttl: number; // 탄 수명 (틱). 탄속 × 수명이 사거리다
  damageMul: number; // 파티마 기본 위력에 곱하는 배율
  pierce: boolean; // 관통: 맞혀도 사라지지 않고 계속 날아간다
  durationTicks: number; // 픽업 무기의 지속 시간 (0이면 기본 무기)
  color: number; // 탄과 총구 화염의 색
  description: string; // 타이틀 무기 설명
}

// 이름은 모터헤드 무장 어휘를 빌린 팬 작명 (플레임 런처, 버스터 런처 등)
export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  0: { name: '플레임 런처', intervalTicks: null, intervalMul: 1, pellets: 1, spreadRad: 0, jitterRad: 0, speed: 900, ttl: 90, damageMul: 1, pierce: false, durationTicks: 0, color: 0xffe066, description: '균형 잡힌 표준 화기' },
  1: { name: '스캐터 캐논', intervalTicks: 30, intervalMul: 1, pellets: 5, spreadRad: 0.42, jitterRad: 0, speed: 800, ttl: 26, damageMul: 0.7, pierce: false, durationTicks: 600, color: 0xffa040, description: '픽업 · 근거리 5발 산탄' },
  2: { name: '레이저 랜스', intervalTicks: 24, intervalMul: 1, pellets: 1, spreadRad: 0, jitterRad: 0, speed: 1400, ttl: 60, damageMul: 2, pierce: true, durationTicks: 600, color: 0x4cf0ff, description: '픽업 · 관통 광선' },
  3: { name: '니들 스트림', intervalTicks: null, intervalMul: 0.5, pellets: 1, spreadRad: 0, jitterRad: 0.16, speed: 900, ttl: 70, damageMul: 0.55, pierce: false, durationTicks: 0, color: 0xfff3b0, description: '속사, 낮은 위력, 탄이 흩어짐' },
  4: { name: '버스터 런처', intervalTicks: null, intervalMul: 3.2, pellets: 1, spreadRad: 0, jitterRad: 0, speed: 1500, ttl: 90, damageMul: 2.4, pierce: false, durationTicks: 0, color: 0xffffff, description: '느리지만 한 발이 무겁고 빠른 중화기' },
  5: { name: '스캐터 건', intervalTicks: null, intervalMul: 2.8, pellets: 4, spreadRad: 0.36, jitterRad: 0, speed: 820, ttl: 24, damageMul: 0.6, pierce: false, durationTicks: 0, color: 0xffa040, description: '근거리 4발 부채꼴' },
};

// 타이틀에서 고를 수 있는 기본 무기. 첫 항목이 기본값.
export const LOADOUTS: Record<CharacterId, readonly WeaponKind[]> = {
  lachesis: [0, 3, 4], // 플레임 런처, 니들 스트림, 버스터 런처
  clotho: [0, 3, 5], // 플레임 런처, 니들 스트림, 스캐터 건
  atropos: [0, 4, 5], // 플레임 런처, 버스터 런처, 스캐터 건
  est: [0, 5, 3], // 플레임 런처, 스캐터 건, 니들 스트림
};

// 기본 무기로 쓸 수 있는가 (지속 시간이 없는 무기만)
export function isLoadoutWeapon(kind: WeaponKind): boolean {
  return WEAPONS[kind].durationTicks === 0;
}

// 교체 직후 잠깐 못 쏘게 해서 연타로 이득 보는 것을 막는다
export const SWAP_DELAY_TICKS = 18; // 0.3초

// 0 힐팩, 1 산탄총, 2 레이저, 3 속도 부스트
export type PickupKind = 0 | 1 | 2 | 3;

export const PICKUP_NAMES: Record<PickupKind, string> = { 0: '리페어 팩', 1: '스캐터 캐논', 2: '레이저 랜스', 3: '이레이저 부스트' };
export const PICKUP_COLORS: Record<PickupKind, number> = { 0: 0x69f0ae, 1: 0xffa040, 2: 0x4cf0ff, 3: 0xffe066 };

export const PICKUP = {
  spawnIntervalTicks: 900, // 둘이 할 때 15초마다 하나
  // 1인 협동은 부활이 없어 한 번의 죽음이 경기를 끝낸다. 회복 기회를 늘려 그 격차를 메운다.
  soloIntervalTicks: 540, // 9초
  max: 3, // 경기장에 동시에 놓일 수 있는 최대 개수
  radius: 14, // 줍는 판정 반지름
  heal: 30, // 리페어 팩 회복량
  boostTicks: 300, // 부스트 지속 (5초)
  boostMul: 1.5, // 부스트 중 이동 속도 배율
  // 종류별 스폰 가중치 (힐팩, 산탄총, 레이저, 부스트)
  weights: [40, 25, 20, 15] as const,
} as const;

// 0..1 난수를 가중치에 따라 픽업 종류로 바꾼다 (누적 가중치 구간에 떨어진 쪽)
export function rollPickupKind(roll01: number): PickupKind {
  const total = PICKUP.weights.reduce((a, b) => a + b, 0);
  let r = roll01 * total;
  for (let i = 0; i < PICKUP.weights.length; i++) {
    r -= PICKUP.weights[i]!;
    if (r < 0) return i as PickupKind;
  }
  return 0; // 부동소수 오차로 끝까지 남으면 힐팩
}
