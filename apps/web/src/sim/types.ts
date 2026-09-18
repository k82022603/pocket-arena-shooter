import type { CharacterId } from './characters';

export interface InputFrame {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
  skill: boolean;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  dash: false,
  skill: false,
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
}

export interface BulletState {
  id: number;
  owner: 0 | 1;
  // 발사를 일으킨 소유자의 입력 틱. 게스트가 예측 탄환과 권위 탄환을 대조하는 키.
  spawnTick: number;
  // 판정 시 상대 위치를 이만큼 과거로 되감는다 (호스트 전용, 전송하지 않음).
  lagTicks: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  ttl: number;
}

export interface SimState {
  tick: number;
  players: [PlayerState, PlayerState];
  bullets: BulletState[];
  nextBulletId: number;
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
