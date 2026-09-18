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
