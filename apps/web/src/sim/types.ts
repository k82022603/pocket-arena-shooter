import type { CharacterId } from './characters';
import type { PickupKind, WeaponKind } from './weapons';

export type GameMode = 'duel' | 'coop';

export interface InputFrame {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
  skill: boolean;
  // 0이면 그대로, 1~3이면 그 번호의 기본 무기로 교체 (한 틱짜리 펄스)
  swapTo: number;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  dash: false,
  skill: false,
  swapTo: 0,
});

export interface PlayerState {
  id: 0 | 1;
  character: CharacterId;
  x: number;
  y: number;
  hp: number;
  aimAngle: number;
  fireCooldown: number;
  dashTicks: number;
  dashCooldown: number;
  // 협동 모드에서 다운된 뒤 아군이 곁에 머문 틱 수.
  reviveProgress: number;
  weapon: WeaponKind;
  // 타이틀에서 고른 기본 무기. 픽업 무기가 끝나면 이것으로 돌아간다.
  baseWeapon: WeaponKind;
  // 픽업 무기 남은 틱.
  weaponTicks: number;
  boostTicks: number;
}

export const ENEMY_OWNER = 2;
export type BulletOwner = 0 | 1 | typeof ENEMY_OWNER;

export interface BulletState {
  id: number;
  owner: BulletOwner;
  kind: WeaponKind;
  // 발사를 일으킨 소유자의 입력 틱. 게스트가 예측 탄환과 권위 탄환을 대조하는 키.
  spawnTick: number;
  // 판정 시 상대 위치를 이만큼 과거로 되감는다 (호스트 전용, 전송하지 않음).
  lagTicks: number;
  // 관통탄이 이미 맞힌 대상 id (호스트 전용, 전송하지 않음).
  hits: number[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  ttl: number;
}

export type EnemyKind = 0 | 1 | 2;

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  fireCooldown: number;
  contactCooldown: number;
}

export interface PickupState {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

// 0 대기(카운트다운), 1 스폰 중, 2 잔여 적 소탕
export type WavePhase = 0 | 1 | 2;

export interface CoopState {
  coreHp: number;
  wave: number;
  phase: WavePhase;
  timer: number;
  // 호스트 전용, 스냅샷에 싣지 않음
  spawnQueue: EnemyKind[];
  enemies: EnemyState[];
  nextEnemyId: number;
}

export interface PlayerStats {
  shots: number;
  hits: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  dashes: number;
  downs: number;
}

export function emptyStats(): PlayerStats {
  return { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0, dashes: 0, downs: 0 };
}

export interface SimState {
  mode: GameMode;
  playerCount: 1 | 2;
  tick: number;
  // 라운드 시작 후 진행한 틱 수 (tick은 단조 기준값에서 시작하므로 따로 센다)
  elapsed: number;
  rngState: number;
  players: [PlayerState, PlayerState];
  stats: [PlayerStats, PlayerStats];
  bullets: BulletState[];
  nextBulletId: number;
  pickups: PickupState[];
  pickupTimer: number;
  nextPickupId: number;
  coop: CoopState | null;
}

export const SIM = {
  tickRate: 60,
  dt: 1 / 60,
  arenaW: 1280,
  arenaH: 720,
  playerRadius: 18,
  playerSpeed: 260,
  bulletSpeed: 900,
  bulletRadius: 4,
  bulletTtl: 90,
  dashSpeedMul: 3,
} as const;

export const COOP = {
  coreX: 640,
  coreY: 360,
  coreRadius: 40,
  coreMaxHp: 500,
  waves: 10,
  breakTicks: 180,
  spawnIntervalTicks: 40,
  reviveRadius: 70,
  reviveTicks: 120,
  reviveHpRatio: 0.5,
  enemyBulletSpeed: 500,
  enemyBulletDamage: 8,
  enemyBulletTtl: 120,
  enemyEngageRange: 600,
} as const;

export interface EnemySpec {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  contactIntervalTicks: number;
  fireIntervalTicks: number;
  keepDistance: number;
  color: number;
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  0: { name: '척후병', hp: 30, speed: 150, radius: 14, contactDamage: 6, contactIntervalTicks: 45, fireIntervalTicks: 0, keepDistance: 0, color: 0xff5252 },
  1: { name: '포수', hp: 50, speed: 120, radius: 16, contactDamage: 5, contactIntervalTicks: 30, fireIntervalTicks: 90, keepDistance: 320, color: 0xb388ff },
  2: { name: '강습병', hp: 200, speed: 70, radius: 26, contactDamage: 20, contactIntervalTicks: 60, fireIntervalTicks: 0, keepDistance: 0, color: 0x8d1f1f },
};
