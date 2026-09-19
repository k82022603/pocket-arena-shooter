import { CHARACTERS } from './characters';
import { damagePlayer } from './core';
import { nextRandom } from './prng';
import { ENEMY_CONTACT_SOURCE, type SimEventSink } from './events';
import { SOLO_ENEMY_SCALE, type Difficulty } from './difficulty';
import {
  COOP,
  ENEMIES,
  ENEMY_OWNER,
  SIM,
  type CoopState,
  type EnemyKind,
  type EnemyState,
  type PlayerState,
  type SimState,
} from './types';

export function createCoopState(): CoopState {
  return {
    coreHp: COOP.coreMaxHp,
    wave: 0,
    phase: 0,
    timer: COOP.breakTicks,
    spawnQueue: [],
    enemies: [],
    nextEnemyId: 1,
  };
}

export function activePlayers(state: SimState): PlayerState[] {
  return state.players.slice(0, state.playerCount);
}

function alivePlayers(state: SimState): PlayerState[] {
  return activePlayers(state).filter((p) => p.hp > 0);
}

// 편성은 2인 기준으로 잡았다. 1인 방어는 화력과 커버 범위가 절반이고 부활도 없어서
// 같은 물량을 내면 코어가 멀쩡한데 플레이어가 먼저 죽는다. 그래서 적 수를 줄여 난이도를 맞춘다.
// 배율은 난이도별로 자동 플레이 측정으로 정했다 (difficulty.ts, 문서: 게임_매뉴얼 협동 방어전 난이도 감각).
export function waveComposition(wave: number, playerCount: 1 | 2 = 2, difficulty: Difficulty = 'normal'): EnemyKind[] {
  const scale = playerCount === 1 ? SOLO_ENEMY_SCALE[difficulty] : 1;
  const scaled = (n: number): number => Math.round(n * scale);
  let rushers = Math.max(1, scaled(2 + wave * 2));
  let gunners = scaled(Math.floor(wave / 2));
  let tanks = wave >= 3 ? scaled(Math.floor((wave - 1) / 2)) : 0;
  const queue: EnemyKind[] = [];
  while (rushers > 0 || gunners > 0 || tanks > 0) {
    for (let i = 0; i < 2 && rushers > 0; i++, rushers--) queue.push(0);
    if (gunners > 0) {
      queue.push(1);
      gunners--;
    }
    if (tanks > 0) {
      queue.push(2);
      tanks--;
    }
  }
  return queue;
}

export function stepCoop(state: SimState, onEvent?: SimEventSink): void {
  const coop = state.coop;
  if (!coop) return;
  stepWaves(state, coop);
  stepEnemies(state, coop, onEvent);
  coop.enemies = coop.enemies.filter((e) => e.hp > 0);
  stepRevive(state, onEvent);
}

function stepWaves(state: SimState, coop: CoopState): void {
  switch (coop.phase) {
    case 0:
      coop.timer -= 1;
      if (coop.timer <= 0) {
        coop.wave += 1;
        coop.spawnQueue = waveComposition(coop.wave, state.playerCount, state.difficulty);
        coop.phase = 1;
        coop.timer = 0;
      }
      return;
    case 1:
      coop.timer -= 1;
      if (coop.timer <= 0) {
        const kind = coop.spawnQueue.shift();
        if (kind !== undefined) spawnEnemy(state, coop, kind);
        coop.timer = COOP.spawnIntervalTicks;
        if (coop.spawnQueue.length === 0) coop.phase = 2;
      }
      return;
    case 2:
      if (coop.enemies.length === 0 && coop.wave < COOP.waves) {
        coop.phase = 0;
        coop.timer = COOP.breakTicks;
      }
      return;
  }
}

function spawnEnemy(state: SimState, coop: CoopState, kind: EnemyKind): void {
  const side = Math.floor(nextRandom(state) * 4);
  const t = nextRandom(state);
  const margin = ENEMIES[kind].radius;
  let x: number;
  let y: number;
  if (side === 0) {
    x = margin;
    y = t * SIM.arenaH;
  } else if (side === 1) {
    x = SIM.arenaW - margin;
    y = t * SIM.arenaH;
  } else if (side === 2) {
    x = t * SIM.arenaW;
    y = margin;
  } else {
    x = t * SIM.arenaW;
    y = SIM.arenaH - margin;
  }
  coop.enemies.push({
    id: coop.nextEnemyId++,
    kind,
    x,
    y,
    hp: ENEMIES[kind].hp,
    fireCooldown: ENEMIES[kind].fireIntervalTicks,
    contactCooldown: 0,
  });
}

interface Target {
  x: number;
  y: number;
  radius: number;
  player: PlayerState | null;
}

function pickTarget(state: SimState, e: EnemyState): Target {
  const core: Target = { x: COOP.coreX, y: COOP.coreY, radius: COOP.coreRadius, player: null };
  if (e.kind === 2) return core;
  let best: PlayerState | null = null;
  let bestDist = Infinity;
  for (const p of alivePlayers(state)) {
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best) return core;
  return { x: best.x, y: best.y, radius: SIM.playerRadius, player: best };
}

function stepEnemies(state: SimState, coop: CoopState, onEvent?: SimEventSink): void {
  for (const e of coop.enemies) {
    const spec = ENEMIES[e.kind];
    if (e.contactCooldown > 0) e.contactCooldown -= 1;
    if (e.fireCooldown > 0) e.fireCooldown -= 1;

    const target = pickTarget(state, e);
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    let move = 1;
    if (spec.keepDistance > 0) {
      if (dist < spec.keepDistance - 40) move = -0.6;
      else if (dist <= spec.keepDistance + 40) move = 0;
    }
    e.x += nx * spec.speed * SIM.dt * move;
    e.y += ny * spec.speed * SIM.dt * move;

    const reach = spec.radius + target.radius;
    if (dist <= reach && e.contactCooldown === 0) {
      e.contactCooldown = spec.contactIntervalTicks;
      const by = ENEMY_CONTACT_SOURCE[e.kind];
      if (target.player) {
        if (target.player.dashTicks === 0) damagePlayer(state, target.player, spec.contactDamage, by, onEvent);
      } else {
        const dealt = Math.min(coop.coreHp, spec.contactDamage);
        coop.coreHp -= dealt;
        if (dealt > 0) onEvent?.({ kind: 'core', amount: dealt, by });
      }
    }

    if (spec.fireIntervalTicks > 0 && e.fireCooldown === 0 && dist < COOP.enemyEngageRange) {
      e.fireCooldown = spec.fireIntervalTicks;
      state.bullets.push({
        id: state.nextBulletId++,
        owner: ENEMY_OWNER,
        kind: 0,
        spawnTick: state.tick,
        lagTicks: 0,
        hits: [],
        x: e.x + nx * (spec.radius + SIM.bulletRadius),
        y: e.y + ny * (spec.radius + SIM.bulletRadius),
        vx: nx * COOP.enemyBulletSpeed,
        vy: ny * COOP.enemyBulletSpeed,
        damage: COOP.enemyBulletDamage,
        ttl: COOP.enemyBulletTtl,
      });
    }
  }

  separateEnemies(coop.enemies);
  for (const e of coop.enemies) {
    const r = ENEMIES[e.kind].radius;
    e.x = clamp(e.x, r, SIM.arenaW - r);
    e.y = clamp(e.y, r, SIM.arenaH - r);
  }
}

function separateEnemies(enemies: EnemyState[]): void {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i]!;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j]!;
      const minDist = ENEMIES[a.kind].radius + ENEMIES[b.kind].radius;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= minDist || dist === 0) continue;
      const push = ((minDist - dist) / 2) * 0.5;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
}

function stepRevive(state: SimState, onEvent?: SimEventSink): void {
  if (state.playerCount < 2) return;
  for (const downed of state.players) {
    if (downed.hp > 0) continue;
    const ally = state.players[downed.id === 0 ? 1 : 0];
    const near = ally.hp > 0 && Math.hypot(ally.x - downed.x, ally.y - downed.y) <= COOP.reviveRadius;
    if (near) {
      downed.reviveProgress += 1;
      if (downed.reviveProgress >= COOP.reviveTicks) {
        downed.reviveProgress = 0;
        downed.hp = Math.floor(CHARACTERS[downed.character].stats.maxHp * COOP.reviveHpRatio);
        onEvent?.({ kind: 'revive', target: downed.id });
      }
    } else {
      downed.reviveProgress = Math.max(0, downed.reviveProgress - 2);
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
