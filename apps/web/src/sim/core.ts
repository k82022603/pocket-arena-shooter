import { CHARACTERS, type CharacterId } from './characters';
import { activePlayers, createCoopState, stepCoop } from './coop';
import type { PositionHistory } from './history';
import type { DamageSource, SimEventSink } from './events';
import type { Difficulty } from './difficulty';
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

// 게임 규칙의 중심. 한 틱(1/60초)을 진행하는 step()과 경기 생성·승패·요약이 여기 있다.
// 같은 상태와 같은 입력이면 항상 같은 결과가 나오도록(결정적) Math.random을 쓰지 않는다.

export interface StepOptions {
  // 각 플레이어의 이번 틱 입력에 붙은 틱 번호 (탄환 spawnTick). 기본은 시뮬레이션 틱.
  inputTicks?: readonly [number, number];
  // 각 플레이어가 쏜 탄환의 판정 되감기 틱 수.
  bulletLag?: readonly [number, number];
  history?: PositionHistory; // 되감기 판정용 위치 기록 (호스트만 넘긴다)
  // 피해·격파·부활을 바깥에 알리는 싱크. 무엇에 맞았는지는 여기로만 나간다.
  onEvent?: SimEventSink;
}

export interface CreateOptions {
  mode: GameMode;
  playerCount: 1 | 2;
  seed: number; // 난수 시드. 픽업 위치·종류와 봇의 선택이 여기서 갈린다
  difficulty?: Difficulty; // 혼자 하기에서만 의미가 있다. 기본 normal
}

// 새 경기의 초기 상태를 만든다
export function createInitialState(
  characters: readonly [CharacterId, CharacterId],
  opts: CreateOptions = { mode: 'duel', playerCount: 2, seed: 1 },
): SimState {
  return {
    mode: opts.mode,
    playerCount: opts.playerCount,
    difficulty: opts.difficulty ?? 'normal',
    tick: 0,
    elapsed: 0,
    rngState: opts.seed >>> 0 || 1, // xorshift는 0에서 멈추므로 0이면 1로 바꾼다
    players: [spawnPlayer(0, characters[0], opts.mode), spawnPlayer(1, characters[1], opts.mode)],
    stats: [emptyStats(), emptyStats()],
    bullets: [],
    nextBulletId: 1,
    pickups: [],
    // 혼자면 회복 기회를 늘리려고 픽업을 더 자주 낸다
    pickupTimer: opts.playerCount === 1 ? PICKUP.soloIntervalTicks : PICKUP.spawnIntervalTicks,
    nextPickupId: 1,
    coop: opts.mode === 'coop' ? createCoopState() : null,
  };
}

function spawnPlayer(id: 0 | 1, character: CharacterId, mode: GameMode): PlayerState {
  const coopX = id === 0 ? COOP.coreX - 80 : COOP.coreX + 80; // 협동: 코어 양옆에서 시작
  return {
    id,
    character,
    x: mode === 'coop' ? coopX : id === 0 ? SIM.arenaW * 0.2 : SIM.arenaW * 0.8, // 대전: 양 끝에서 마주 본다
    y: SIM.arenaH / 2,
    hp: CHARACTERS[character].stats.maxHp,
    aimAngle: id === 0 ? 0 : Math.PI, // 0번은 오른쪽, 1번은 왼쪽을 본다
    fireCooldown: 0,
    dashTicks: 0,
    dashCooldown: 0,
    reviveProgress: 0,
    weapon: 0,
    baseWeapon: 0,
    weaponTicks: 0,
    boostTicks: 0,
    knockX: 0,
    knockY: 0,
  };
}

// 경기 시작 직후 상대가 고른 파티마가 도착하면 바꿔 끼운다
export function setPlayerCharacter(state: SimState, id: 0 | 1, character: CharacterId): void {
  const p = state.players[id];
  if (p.character === character) return;
  const wasFull = p.hp >= CHARACTERS[p.character].stats.maxHp;
  p.character = character;
  if (wasFull) p.hp = CHARACTERS[character].stats.maxHp; // 아직 안 맞았으면 새 파티마의 최대 체력으로
}

// 기본 무기를 정한다. 픽업 무기를 들고 있으면 그것이 끝난 뒤부터 적용된다
export function setPlayerLoadout(state: SimState, id: 0 | 1, weapon: WeaponKind): void {
  if (!isLoadoutWeapon(weapon)) return; // 픽업 전용 무기는 기본 무기가 될 수 없다
  const p = state.players[id];
  p.baseWeapon = weapon;
  if (p.weaponTicks === 0) p.weapon = weapon;
}

// 한 틱 진행: 입력 적용 → 발사 → 위치 기록 → 탄환 이동·판정 → 픽업 → 협동(웨이브·적·부활)
export function step(state: SimState, inputs: readonly [InputFrame, InputFrame], opts: StepOptions = {}): void {
  state.tick += 1;
  state.elapsed += 1;
  const inputTicks = opts.inputTicks ?? [state.tick, state.tick];
  const lag = opts.bulletLag ?? [0, 0];
  for (const p of activePlayers(state)) {
    if (p.hp <= 0) continue; // 다운된 사람은 조작이 먹지 않는다
    const stats = CHARACTERS[p.character].stats;
    applyPlayerInput(p, inputs[p.id]);
    // 대시가 막 시작된 틱(남은 틱과 쿨다운이 둘 다 최대값)에만 센다
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
  // 이동을 마친 위치를 기록해 둔다. 나중에 지연된 탄환이 이 시점으로 되감아 판정한다
  opts.history?.record(state.tick, state.players);
  if (state.coop) opts.history?.recordEnemies(state.tick, state.coop.enemies);
  stepBullets(state, opts.history, opts.onEvent);
  stepPickups(state);
  if (state.mode === 'coop') stepCoop(state, opts.onEvent);
}

// 이동·조준·대시·쿨다운만 진행한다. 발사는 consumeFire/makeBullets로 분리해 게스트 예측에서 재사용한다.
export function applyPlayerInput(p: PlayerState, input: InputFrame): void {
  if (p.hp <= 0) return;
  const stats = CHARACTERS[p.character].stats;

  // 각종 타이머를 한 틱씩 줄인다
  if (p.fireCooldown > 0) p.fireCooldown -= 1;
  if (p.dashCooldown > 0) p.dashCooldown -= 1;
  if (p.dashTicks > 0) p.dashTicks -= 1;
  if (p.boostTicks > 0) p.boostTicks -= 1;
  if (p.weaponTicks > 0) {
    p.weaponTicks -= 1;
    if (p.weaponTicks === 0) p.weapon = p.baseWeapon; // 픽업 무기가 끝나면 기본 무기로
  }

  // 대시: 쿨다운이 끝났고 이미 대시 중이 아닐 때만
  if (input.dash && p.dashCooldown === 0 && p.dashTicks === 0) {
    p.dashTicks = stats.dashTicks;
    p.dashCooldown = stats.dashCooldownTicks;
  }

  // 기본 무기 교체. 픽업 무기를 들고 있으면 픽업이 끝난 뒤부터 적용된다.
  if (input.swapTo > 0) {
    const target = LOADOUTS[p.character][input.swapTo - 1]; // 1~3번 → 이 파티마의 선택지
    if (target !== undefined && target !== p.baseWeapon) {
      p.baseWeapon = target;
      if (p.weaponTicks === 0) {
        p.weapon = target;
        p.fireCooldown = Math.max(p.fireCooldown, SWAP_DELAY_TICKS); // 바꾼 직후 잠깐 쏘지 못한다
      }
    }
  }

  // 이동: 기준 속도 × 파티마 배율 × 부스트 × 대시. 넉백 속도는 따로 더한다
  const boost = p.boostTicks > 0 ? PICKUP.boostMul : 1;
  const speed = SIM.playerSpeed * stats.speedMul * boost * (p.dashTicks > 0 ? SIM.dashSpeedMul : 1);
  p.x += (input.moveX * speed + p.knockX) * SIM.dt;
  p.y += (input.moveY * speed + p.knockY) * SIM.dt;
  decayKnock(p);
  // 경기장 밖으로 나가지 않게 가둔다
  p.x = clamp(p.x, SIM.playerRadius, SIM.arenaW - SIM.playerRadius);
  p.y = clamp(p.y, SIM.playerRadius, SIM.arenaH - SIM.playerRadius);

  // 조준 입력이 있을 때만 방향을 바꾼다. 손을 떼도 마지막 방향을 유지한다
  if (Math.hypot(input.aimX, input.aimY) > 0) p.aimAngle = Math.atan2(input.aimY, input.aimX);
}

// 넉백: 순간이동 대신 짧게 미끄러지게 한다. 매 틱 속도를 줄이고, 충분히 작아지면 멈춘다.
// 게스트 예측도 applyPlayerInput을 거치므로 같은 궤적이 나온다(knockX/Y는 스냅샷에 실린다).
function decayKnock(p: PlayerState): void {
  p.knockX *= SIM.knockDecay;
  p.knockY *= SIM.knockDecay;
  if (Math.hypot(p.knockX, p.knockY) < 8) {
    // 초당 8px 미만이면 멈춘 것으로 본다 (끝없이 작아지는 값을 정리)
    p.knockX = 0;
    p.knockY = 0;
  }
}

/** (nx, ny) 방향으로 speed(px/s)만큼 밀어낸다. 이미 밀려나는 중이면 더 센 쪽을 따른다 */
export function knockPlayer(p: PlayerState, nx: number, ny: number, speed: number): void {
  if (Math.hypot(p.knockX, p.knockY) >= speed) return;
  p.knockX = nx * speed;
  p.knockY = ny * speed;
}

// 이번 틱에 발사하는가. 발사하면 쿨다운을 건다
export function consumeFire(p: PlayerState, input: InputFrame): boolean {
  if (p.hp <= 0 || !input.fire || p.fireCooldown > 0) return false;
  const spec = WEAPONS[p.weapon];
  // 무기가 고정 간격을 가지면 그것을, 아니면 파티마의 연사 간격 × 무기 배율 (최소 3틱)
  p.fireCooldown = spec.intervalTicks ?? Math.max(3, Math.round(CHARACTERS[p.character].stats.fireIntervalTicks * spec.intervalMul));
  return true;
}

// 현재 무기로 한 번 발사했을 때 생기는 탄환들. id는 firstId부터 연속.
// 흔들림은 spawnTick에서 결정적으로 뽑아 호스트와 게스트 예측이 같은 각도를 얻는다.
export function makeBullets(p: PlayerState, firstId: number, spawnTick: number, lagTicks: number): BulletState[] {
  const weapon = WEAPONS[p.weapon];
  const damage = Math.max(1, Math.round(CHARACTERS[p.character].stats.damage * weapon.damageMul));
  // 큰 소수를 곱해 0..1 사이 값을 만들고 -0.5..0.5로 옮긴다. 같은 틱이면 누가 계산해도 같다
  const jitter = weapon.jitterRad === 0 ? 0 : (((spawnTick * 7919 + p.id * 104729) % 1000) / 1000 - 0.5) * weapon.jitterRad;
  const bullets: BulletState[] = [];
  for (let i = 0; i < weapon.pellets; i++) {
    // 산탄: 알을 부채꼴 폭(spreadRad)에 고르게 펼친다. 한 알이면 정면
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
      // 자기 몸에 맞지 않도록 몸 바깥에서 시작한다
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

// 원과 원의 충돌: 두 중심 거리가 반지름 합보다 작으면 맞은 것
export function bulletHits(b: BulletState, tx: number, ty: number, targetRadius: number = SIM.playerRadius): boolean {
  return Math.hypot(tx - b.x, ty - b.y) < targetRadius + SIM.bulletRadius;
}

// 플레이어에게 피해를 주고 통계에 반영한다. 실제로 깎인 양을 돌려준다.
export function damagePlayer(
  state: SimState,
  target: PlayerState,
  amount: number,
  by: DamageSource,
  onEvent?: SimEventSink,
): number {
  const dealt = Math.min(target.hp, amount); // 남은 체력보다 많이 깎지 않는다 (통계가 부풀지 않게)
  if (dealt <= 0) return 0;
  target.hp -= dealt;
  const stats = state.stats[target.id];
  stats.damageTaken += dealt;
  onEvent?.({ kind: 'hurt', target: target.id, amount: dealt, by });
  if (target.hp <= 0) {
    stats.downs += 1;
    onEvent?.({ kind: 'down', target: target.id });
  }
  return dealt;
}

// 모든 탄환을 한 틱 움직이고 판정한다. 맞았거나 수명이 다한 탄은 목록에서 빠진다
function stepBullets(state: SimState, history?: PositionHistory, onEvent?: SimEventSink): void {
  const alive: BulletState[] = [];
  for (const b of state.bullets) {
    if (!advanceBullet(b)) continue;
    // 누가 쏜 탄이냐, 어떤 모드냐에 따라 맞힐 대상이 다르다
    const consumed =
      b.owner === ENEMY_OWNER
        ? enemyBulletHit(state, b, onEvent)
        : state.mode === 'coop'
          ? coopBulletHit(state, b, history, onEvent)
          : duelBulletHit(state, b, history, onEvent);
    if (consumed) continue;
    alive.push(b);
  }
  state.bullets = alive;
}

// 맞혔을 때 탄환을 없애야 하면 true. 관통탄은 같은 대상을 다시 맞히지 않고 계속 날아간다.
function duelBulletHit(state: SimState, b: BulletState, history?: PositionHistory, onEvent?: SimEventSink): boolean {
  const target = state.players[b.owner === 0 ? 1 : 0]; // 대전에서는 상대만 맞는다
  if (b.hits.includes(target.id)) return false;
  // 게스트가 쏜 탄이면 게스트가 보고 있던 과거 시점의 상대 위치로 되감는다
  const pose = b.lagTicks > 0 ? history?.lookup(target.id, state.tick - b.lagTicks) : null;
  const tx = pose?.x ?? target.x;
  const ty = pose?.y ?? target.y;
  const invulnerable = (pose?.dashTicks ?? target.dashTicks) > 0; // 그 시점에 대시 중이었으면 무적
  if (target.hp > 0 && !invulnerable && bulletHits(b, tx, ty)) {
    const dealt = damagePlayer(state, target, b.damage, 'peerShot', onEvent);
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

// 협동에서 플레이어 탄은 적만 맞힌다. 아군은 그냥 통과한다(아군 피해 없음)
function coopBulletHit(state: SimState, b: BulletState, history?: PositionHistory, onEvent?: SimEventSink): boolean {
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
    if (e.hp <= 0) {
      shooter.kills += 1;
      onEvent?.({ kind: 'kill', by: b.owner as 0 | 1, enemy: e.kind });
    }
    if (!pierce) return true; // 일반 탄은 첫 적에서 멈춘다
    b.hits.push(e.id); // 관통탄은 기억해 두고 계속 날아간다
  }
  return false;
}

// 포수의 탄: 플레이어를 먼저 보고, 아무도 안 맞았으면 코어를 본다
function enemyBulletHit(state: SimState, b: BulletState, onEvent?: SimEventSink): boolean {
  for (const p of activePlayers(state)) {
    if (p.hp > 0 && p.dashTicks === 0 && bulletHits(b, p.x, p.y)) {
      damagePlayer(state, p, b.damage, 'gunnerShot', onEvent);
      return true;
    }
  }
  const coop = state.coop;
  if (coop && bulletHits(b, COOP.coreX, COOP.coreY, COOP.coreRadius)) {
    // 빗나간 탄이 코어를 깎는다. 포수를 먼저 잡아야 하는 이유
    const dealt = Math.min(coop.coreHp, b.damage);
    coop.coreHp -= dealt;
    if (dealt > 0) onEvent?.({ kind: 'core', amount: dealt, by: 'gunnerShot' });
    return true;
  }
  return false;
}

// 픽업: 일정 간격으로 무작위 위치에 하나씩 놓고(최대 개수까지), 닿은 사람이 먹는다
function stepPickups(state: SimState): void {
  state.pickupTimer -= 1;
  if (state.pickupTimer <= 0) {
    state.pickupTimer = state.playerCount === 1 ? PICKUP.soloIntervalTicks : PICKUP.spawnIntervalTicks;
    if (state.pickups.length < PICKUP.max) {
      state.pickups.push({
        id: state.nextPickupId++,
        kind: rollPickupKind(nextRandom(state)),
        // 가장자리에 붙지 않게 가로 200px, 세로 120px 안쪽에만 놓는다
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
        return false; // 먹은 픽업은 목록에서 뺀다
      }
    }
    return true;
  });
}

function applyPickup(p: PlayerState, kind: PickupKind): void {
  switch (kind) {
    case 0: // 리페어 팩: 체력 회복 (최대 체력을 넘지 않는다)
      p.hp = Math.min(CHARACTERS[p.character].stats.maxHp, p.hp + PICKUP.heal);
      return;
    case 1: // 스캐터 캐논
    case 2: // 레이저 랜스: 일정 시간 들고, 끝나면 기본 무기로 돌아간다
      p.weapon = kind;
      p.weaponTicks = WEAPONS[kind].durationTicks;
      p.fireCooldown = 0; // 먹자마자 쏠 수 있게
      return;
    case 3: // 이레이저 부스트: 이동 속도 증가
      p.boostTicks = PICKUP.boostTicks;
      return;
  }
}

export type Outcome = { mode: 'duel'; winner: 0 | 1 } | { mode: 'coop'; won: boolean; wave: number };

// 경기가 끝났으면 결과를, 아직이면 null
export function outcomeOf(state: SimState): Outcome | null {
  if (state.mode === 'duel') {
    const [p0, p1] = state.players;
    if (p0.hp > 0 && p1.hp > 0) return null;
    return { mode: 'duel', winner: p0.hp > 0 ? 0 : 1 };
  }
  const coop = state.coop;
  if (!coop) return null;
  // 패배: 코어가 부서졌거나, 뛰는 사람이 모두 다운됐다
  if (coop.coreHp <= 0 || activePlayers(state).every((p) => p.hp <= 0)) {
    return { mode: 'coop', won: false, wave: coop.wave };
  }
  // 승리: 마지막 웨이브의 스폰이 끝나고 남은 적까지 모두 처치했다
  if (coop.wave >= COOP.waves && coop.phase === 2 && coop.enemies.length === 0) {
    return { mode: 'coop', won: true, wave: coop.wave };
  }
  return null;
}

// 결과 화면에 넘기는 요약. 상태를 그대로 넘기지 않고 필요한 것만 복사한다
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
      { character: state.players[0].character, stats: { ...state.stats[0] } }, // 복사본: 이후 변경이 결과에 새지 않게
      { character: state.players[1].character, stats: { ...state.stats[1] } },
    ],
    coop: state.coop ? { wave: state.coop.wave, coreHp: state.coop.coreHp } : null,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
