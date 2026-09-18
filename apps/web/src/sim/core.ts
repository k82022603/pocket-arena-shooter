import { CHARACTERS, type CharacterId } from './characters';
import { SIM, type InputFrame, type PlayerState, type SimState } from './types';

export function createInitialState(characters: readonly [CharacterId, CharacterId]): SimState {
  return {
    tick: 0,
    players: [spawnPlayer(0, characters[0]), spawnPlayer(1, characters[1])],
    bullets: [],
    nextBulletId: 1,
  };
}

function spawnPlayer(id: 0 | 1, character: CharacterId): PlayerState {
  return {
    id,
    character,
    x: id === 0 ? SIM.arenaW * 0.2 : SIM.arenaW * 0.8,
    y: SIM.arenaH / 2,
    hp: CHARACTERS[character].stats.maxHp,
    aimAngle: id === 0 ? 0 : Math.PI,
    fireCooldown: 0,
    dashTicks: 0,
    dashCooldown: 0,
  };
}

export function setPlayerCharacter(state: SimState, id: 0 | 1, character: CharacterId): void {
  const p = state.players[id];
  if (p.character === character) return;
  const wasFull = p.hp >= CHARACTERS[p.character].stats.maxHp;
  p.character = character;
  if (wasFull) p.hp = CHARACTERS[character].stats.maxHp;
}

export function step(state: SimState, inputs: readonly [InputFrame, InputFrame]): void {
  state.tick += 1;
  for (const p of state.players) {
    if (p.hp <= 0) continue;
    applyPlayerInput(p, inputs[p.id]);
    tryFire(state, p, inputs[p.id]);
  }
  stepBullets(state);
}

// 이동·조준·대시·쿨다운만 진행한다. 발사는 호스트 권위이므로 게스트 예측에서는 호출하지 않는다.
export function applyPlayerInput(p: PlayerState, input: InputFrame): void {
  if (p.hp <= 0) return;
  const stats = CHARACTERS[p.character].stats;

  if (p.fireCooldown > 0) p.fireCooldown -= 1;
  if (p.dashCooldown > 0) p.dashCooldown -= 1;
  if (p.dashTicks > 0) p.dashTicks -= 1;

  if (input.dash && p.dashCooldown === 0 && p.dashTicks === 0) {
    p.dashTicks = stats.dashTicks;
    p.dashCooldown = stats.dashCooldownTicks;
  }

  const speed = SIM.playerSpeed * stats.speedMul * (p.dashTicks > 0 ? SIM.dashSpeedMul : 1);
  p.x += input.moveX * speed * SIM.dt;
  p.y += input.moveY * speed * SIM.dt;
  p.x = clamp(p.x, SIM.playerRadius, SIM.arenaW - SIM.playerRadius);
  p.y = clamp(p.y, SIM.playerRadius, SIM.arenaH - SIM.playerRadius);

  if (Math.hypot(input.aimX, input.aimY) > 0) p.aimAngle = Math.atan2(input.aimY, input.aimX);
}

function tryFire(state: SimState, p: PlayerState, input: InputFrame): void {
  if (!input.fire || p.fireCooldown > 0) return;
  const stats = CHARACTERS[p.character].stats;
  p.fireCooldown = stats.fireIntervalTicks;
  const dx = Math.cos(p.aimAngle);
  const dy = Math.sin(p.aimAngle);
  state.bullets.push({
    id: state.nextBulletId++,
    owner: p.id,
    x: p.x + dx * (SIM.playerRadius + SIM.bulletRadius),
    y: p.y + dy * (SIM.playerRadius + SIM.bulletRadius),
    vx: dx * SIM.bulletSpeed,
    vy: dy * SIM.bulletSpeed,
    damage: stats.damage,
    ttl: SIM.bulletTtl,
  });
}

function stepBullets(state: SimState): void {
  const alive: SimState['bullets'] = [];
  for (const b of state.bullets) {
    b.x += b.vx * SIM.dt;
    b.y += b.vy * SIM.dt;
    b.ttl -= 1;
    if (b.ttl <= 0 || b.x < 0 || b.y < 0 || b.x > SIM.arenaW || b.y > SIM.arenaH) continue;

    const target = state.players[b.owner === 0 ? 1 : 0];
    const hit =
      target.hp > 0 &&
      target.dashTicks === 0 &&
      Math.hypot(target.x - b.x, target.y - b.y) < SIM.playerRadius + SIM.bulletRadius;
    if (hit) {
      target.hp = Math.max(0, target.hp - b.damage);
      continue;
    }
    alive.push(b);
  }
  state.bullets = alive;
}

export function winnerOf(state: SimState): 0 | 1 | null {
  const [p0, p1] = state.players;
  if (p0.hp > 0 && p1.hp > 0) return null;
  return p0.hp > 0 ? 0 : 1;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
