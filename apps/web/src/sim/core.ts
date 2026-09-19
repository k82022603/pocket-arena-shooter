import { CHARACTERS, type CharacterId } from './characters';
import { activePlayers, createCoopState, stepCoop } from './coop';
import type { PositionHistory } from './history';
import { nextRandom } from './prng';
import {
  COOP,
  ENEMIES,
  ENEMY_OWNER,
  SIM,
  emptyStats,
  type BulletState,
  type GameMode,
  type InputFrame,
  type PlayerState,
  type PlayerStats,
  type SimState,
} from './types';
import { LOADOUTS, PICKUP, SWAP_DELAY_TICKS, WEAPONS, isLoadoutWeapon, rollPickupKind, type PickupKind, type WeaponKind } from './weapons';

export interface StepOptions {
  // 각 플레이어의 이번 틱 입력에 붙은 틱 번호 (탄환 spawnTick). 기본은 시뮬레이션 틱.
  inputTicks?: readonly [number, number];
  // 각 플레이어가 쏜 탄환의 판정 되감기 틱 수.
  bulletLag?: readonly [number, number];
  history?: PositionHistory;
}

export interface CreateOptions {
  mode: GameMode;
  playerCount: 1 | 2;
  seed: number;
}

export function createInitialState(
  characters: readonly [CharacterId, CharacterId],
  opts: CreateOptions = { mode: 'duel', playerCount: 2, seed: 1 },
): SimState {
  return {
    mode: opts.mode,
    playerCount: opts.playerCount,
    tick: 0,
    elapsed: 0,
    rngState: opts.seed >>> 0 || 1,
    players: [spawnPlayer(0, characters[0], opts.mode), spawnPlayer(1, characters[1], opts.mode)],
    stats: [emptyStats(), emptyStats()],
    bullets: [],
    nextBulletId: 1,
    pickups: [],
    pickupTimer: opts.playerCount === 1 ? PICKUP.soloIntervalTicks : PICKUP.spawnIntervalTicks,
    nextPickupId: 1,
    coop: opts.mode === 'coop' ? createCoopState() : null,
  };
}

function spawnPlayer(id: 0 | 1, character: CharacterId, mode: GameMode): PlayerState {
  const coopX = id === 0 ? COOP.coreX - 80 : COOP.coreX + 80;
  return {
    id,
    character,
    x: mode === 'coop' ? coopX : id === 0 ? SIM.arenaW * 0.2 : SIM.arenaW * 0.8,
    y: SIM.arenaH / 2,
    hp: CHARACTERS[character].stats.maxHp,
    aimAngle: id === 0 ? 0 : Math.PI,
    fireCooldown: 0,
    dashTicks: 0,
    dashCooldown: 0,
    reviveProgress: 0,
    weapon: 0,
    baseWeapon: 0,
    weaponTicks: 0,
    boostTicks: 0,
  };
}

export function setPlayerCharacter(state: SimState, id: 0 | 1, character: CharacterId): void {
  const p = state.players[id];
  if (p.character === character) return;
  const wasFull = p.hp >= CHARACTERS[p.character].stats.maxHp;
  p.character = character;
  if (wasFull) p.hp = CHARACTERS[character].stats.maxHp;
}

export function setPlayerLoadout(state: SimState, id: 0 | 1, weapon: WeaponKind): void {
  if (!isLoadoutWeapon(weapon)) return;
  const p = state.players[id];
  p.baseWeapon = weapon;
  if (p.weaponTicks === 0) p.weapon = weapon;
}

export function step(state: SimState, inputs: readonly [InputFrame, InputFrame], opts: StepOptions = {}): void {
  state.tick += 1;
  state.elapsed += 1;
  const inputTicks = opts.inputTicks ?? [state.tick, state.tick];
  const lag = opts.bulletLag ?? [0, 0];
  for (const p of activePlayers(state)) {
    if (p.hp <= 0) continue;
    const stats = CHARACTERS[p.character].stats;
    applyPlayerInput(p, inputs[p.id]);
    if (p.dashTicks === stats.dashTicks && p.dashCooldown === stats.dashCooldownTicks) state.stats[p.id].dashes += 1;
    if (consumeFire(p, inputs[p.id])) {
      const bullets = makeBullets(p, state.nextBulletId, inputTicks[p.id], lag[p.id]);
      // 명중은 탄알 단위로 세므로 발사도 탄알 단위로 센다. 방아쇠 횟수로 세면
      // 산탄 무기에서 명중이 발사보다 많아져 명중률이 100%를 넘는다.
      state.stats[p.id].shots += bullets.length;
      state.nextBulletId += bullets.length;
      state.bullets.push(...bullets);
    }
  }
  opts.history?.record(state.tick, state.players);
  if (state.coop) opts.history?.recordEnemies(state.tick, state.coop.enemies);
  stepBullets(state, opts.history);
  stepPickups(state);
  if (state.mode === 'coop') stepCoop(state);
}

// 이동·조준·대시·쿨다운만 진행한다. 발사는 consumeFire/makeBullets로 분리해 게스트 예측에서 재사용한다.
export function applyPlayerInput(p: PlayerState, input: InputFrame): void {
  if (p.hp <= 0) return;
  const stats = CHARACTERS[p.character].stats;

  if (p.fireCooldown > 0) p.fireCooldown -= 1;
  if (p.dashCooldown > 0) p.dashCooldown -= 1;
  if (p.dashTicks > 0) p.dashTicks -= 1;
  if (p.boostTicks > 0) p.boostTicks -= 1;
  if (p.weaponTicks > 0) {
    p.weaponTicks -= 1;
    if (p.weaponTicks === 0) p.weapon = p.baseWeapon;
  }

  if (input.dash && p.dashCooldown === 0 && p.dashTicks === 0) {
    p.dashTicks = stats.dashTicks;
    p.dashCooldown = stats.dashCooldownTicks;
  }

  // 기본 무기 교체. 픽업 무기를 들고 있으면 픽업이 끝난 뒤부터 적용된다.
  if (input.swapTo > 0) {
    const target = LOADOUTS[p.character][input.swapTo - 1];
    if (target !== undefined && target !== p.baseWeapon) {
      p.baseWeapon = target;
      if (p.weaponTicks === 0) {
        p.weapon = target;
        p.fireCooldown = Math.max(p.fireCooldown, SWAP_DELAY_TICKS);
      }
    }
  }

  const boost = p.boostTicks > 0 ? PICKUP.boostMul : 1;
  const speed = SIM.playerSpeed * stats.speedMul * boost * (p.dashTicks > 0 ? SIM.dashSpeedMul : 1);
  p.x += input.moveX * speed * SIM.dt;
  p.y += input.moveY * speed * SIM.dt;
  p.x = clamp(p.x, SIM.playerRadius, SIM.arenaW - SIM.playerRadius);
  p.y = clamp(p.y, SIM.playerRadius, SIM.arenaH - SIM.playerRadius);

  if (Math.hypot(input.aimX, input.aimY) > 0) p.aimAngle = Math.atan2(input.aimY, input.aimX);
}

export function consumeFire(p: PlayerState, input: InputFrame): boolean {
  if (p.hp <= 0 || !input.fire || p.fireCooldown > 0) return false;
  const spec = WEAPONS[p.weapon];
  p.fireCooldown = spec.intervalTicks ?? Math.max(3, Math.round(CHARACTERS[p.character].stats.fireIntervalTicks * spec.intervalMul));
  return true;
}

// 현재 무기로 한 번 발사했을 때 생기는 탄환들. id는 firstId부터 연속.
// 흔들림은 spawnTick에서 결정적으로 뽑아 호스트와 게스트 예측이 같은 각도를 얻는다.
export function makeBullets(p: PlayerState, firstId: number, spawnTick: number, lagTicks: number): BulletState[] {
  const weapon = WEAPONS[p.weapon];
  const damage = Math.max(1, Math.round(CHARACTERS[p.character].stats.damage * weapon.damageMul));
  const jitter = weapon.jitterRad === 0 ? 0 : (((spawnTick * 7919 + p.id * 104729) % 1000) / 1000 - 0.5) * weapon.jitterRad;
  const bullets: BulletState[] = [];
  for (let i = 0; i < weapon.pellets; i++) {
    const offset = weapon.pellets === 1 ? 0 : (i / (weapon.pellets - 1) - 0.5) * weapon.spreadRad;
    const angle = p.aimAngle + offset + jitter;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    bullets.push({
      id: firstId + i,
      owner: p.id,
      kind: p.weapon,
      spawnTick,
      lagTicks,
      hits: [],
      x: p.x + dx * (SIM.playerRadius + SIM.bulletRadius),
      y: p.y + dy * (SIM.playerRadius + SIM.bulletRadius),
      vx: dx * weapon.speed,
      vy: dy * weapon.speed,
      damage,
      ttl: weapon.ttl,
    });
  }
  return bullets;
}

// 탄환을 한 틱 전진시키고, 수명·경계 안에 남아 있으면 true.
export function advanceBullet(b: BulletState): boolean {
  b.x += b.vx * SIM.dt;
  b.y += b.vy * SIM.dt;
  b.ttl -= 1;
  return b.ttl > 0 && b.x >= 0 && b.y >= 0 && b.x <= SIM.arenaW && b.y <= SIM.arenaH;
}

export function bulletHits(b: BulletState, tx: number, ty: number, targetRadius: number = SIM.playerRadius): boolean {
  return Math.hypot(tx - b.x, ty - b.y) < targetRadius + SIM.bulletRadius;
}

// 플레이어에게 피해를 주고 통계에 반영한다. 실제로 깎인 양을 돌려준다.
export function damagePlayer(state: SimState, target: PlayerState, amount: number): number {
  const dealt = Math.min(target.hp, amount);
  if (dealt <= 0) return 0;
  target.hp -= dealt;
  const stats = state.stats[target.id];
  stats.damageTaken += dealt;
  if (target.hp <= 0) stats.downs += 1;
  return dealt;
}

function stepBullets(state: SimState, history?: PositionHistory): void {
  const alive: BulletState[] = [];
  for (const b of state.bullets) {
    if (!advanceBullet(b)) continue;
    const consumed =
      b.owner === ENEMY_OWNER
        ? enemyBulletHit(state, b)
        : state.mode === 'coop'
          ? coopBulletHit(state, b, history)
          : duelBulletHit(state, b, history);
    if (consumed) continue;
    alive.push(b);
  }
  state.bullets = alive;
}

// 맞혔을 때 탄환을 없애야 하면 true. 관통탄은 같은 대상을 다시 맞히지 않고 계속 날아간다.
function duelBulletHit(state: SimState, b: BulletState, history?: PositionHistory): boolean {
  const target = state.players[b.owner === 0 ? 1 : 0];
  if (b.hits.includes(target.id)) return false;
  const pose = b.lagTicks > 0 ? history?.lookup(target.id, state.tick - b.lagTicks) : null;
  const tx = pose?.x ?? target.x;
  const ty = pose?.y ?? target.y;
  const invulnerable = (pose?.dashTicks ?? target.dashTicks) > 0;
  if (target.hp > 0 && !invulnerable && bulletHits(b, tx, ty)) {
    const dealt = damagePlayer(state, target, b.damage);
    const shooter = state.stats[b.owner as 0 | 1];
    shooter.hits += 1;
    shooter.damageDealt += dealt;
    if (WEAPONS[b.kind].pierce) {
      b.hits.push(target.id);
      return false;
    }
    return true;
  }
  return false;
}

function coopBulletHit(state: SimState, b: BulletState, history?: PositionHistory): boolean {
  const coop = state.coop;
  if (!coop) return false;
  const pierce = WEAPONS[b.kind].pierce;
  for (const e of coop.enemies) {
    if (e.hp <= 0 || b.hits.includes(e.id)) continue;
    // 게스트는 보간 지연 + RTT/2 만큼 과거의 적을 보고 쏜다. 쏜 사람이 본 시점으로 되감아 판정한다.
    const pose = b.lagTicks > 0 ? history?.lookupEnemy(e.id, state.tick - b.lagTicks) : null;
    if (!bulletHits(b, pose?.x ?? e.x, pose?.y ?? e.y, ENEMIES[e.kind].radius)) continue;
    const dealt = Math.min(e.hp, b.damage);
    e.hp -= dealt;
    const shooter = state.stats[b.owner as 0 | 1];
    shooter.hits += 1;
    shooter.damageDealt += dealt;
    if (e.hp <= 0) shooter.kills += 1;
    if (!pierce) return true;
    b.hits.push(e.id);
  }
  return false;
}

function enemyBulletHit(state: SimState, b: BulletState): boolean {
  for (const p of activePlayers(state)) {
    if (p.hp > 0 && p.dashTicks === 0 && bulletHits(b, p.x, p.y)) {
      damagePlayer(state, p, b.damage);
      return true;
    }
  }
  const coop = state.coop;
  if (coop && bulletHits(b, COOP.coreX, COOP.coreY, COOP.coreRadius)) {
    coop.coreHp = Math.max(0, coop.coreHp - b.damage);
    return true;
  }
  return false;
}

function stepPickups(state: SimState): void {
  state.pickupTimer -= 1;
  if (state.pickupTimer <= 0) {
    state.pickupTimer = state.playerCount === 1 ? PICKUP.soloIntervalTicks : PICKUP.spawnIntervalTicks;
    if (state.pickups.length < PICKUP.max) {
      state.pickups.push({
        id: state.nextPickupId++,
        kind: rollPickupKind(nextRandom(state)),
        x: 200 + nextRandom(state) * (SIM.arenaW - 400),
        y: 120 + nextRandom(state) * (SIM.arenaH - 240),
      });
    }
  }
  const alive = activePlayers(state).filter((p) => p.hp > 0);
  state.pickups = state.pickups.filter((pk) => {
    for (const p of alive) {
      if (Math.hypot(p.x - pk.x, p.y - pk.y) < PICKUP.radius + SIM.playerRadius) {
        applyPickup(p, pk.kind);
        return false;
      }
    }
    return true;
  });
}

function applyPickup(p: PlayerState, kind: PickupKind): void {
  switch (kind) {
    case 0:
      p.hp = Math.min(CHARACTERS[p.character].stats.maxHp, p.hp + PICKUP.heal);
      return;
    case 1:
    case 2:
      p.weapon = kind;
      p.weaponTicks = WEAPONS[kind].durationTicks;
      p.fireCooldown = 0;
      return;
    case 3:
      p.boostTicks = PICKUP.boostTicks;
      return;
  }
}

export type Outcome = { mode: 'duel'; winner: 0 | 1 } | { mode: 'coop'; won: boolean; wave: number };

export function outcomeOf(state: SimState): Outcome | null {
  if (state.mode === 'duel') {
    const [p0, p1] = state.players;
    if (p0.hp > 0 && p1.hp > 0) return null;
    return { mode: 'duel', winner: p0.hp > 0 ? 0 : 1 };
  }
  const coop = state.coop;
  if (!coop) return null;
  if (coop.coreHp <= 0 || activePlayers(state).every((p) => p.hp <= 0)) {
    return { mode: 'coop', won: false, wave: coop.wave };
  }
  if (coop.wave >= COOP.waves && coop.phase === 2 && coop.enemies.length === 0) {
    return { mode: 'coop', won: true, wave: coop.wave };
  }
  return null;
}

export interface MatchSummary {
  mode: GameMode;
  playerCount: 1 | 2;
  elapsedTicks: number;
  players: [{ character: CharacterId; stats: PlayerStats }, { character: CharacterId; stats: PlayerStats }];
  coop: { wave: number; coreHp: number } | null;
}

export function summarize(state: SimState): MatchSummary {
  return {
    mode: state.mode,
    playerCount: state.playerCount,
    elapsedTicks: state.elapsed,
    players: [
      { character: state.players[0].character, stats: { ...state.stats[0] } },
      { character: state.players[1].character, stats: { ...state.stats[1] } },
    ],
    coop: state.coop ? { wave: state.coop.wave, coreHp: state.coop.coreHp } : null,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
