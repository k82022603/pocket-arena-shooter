import { CHARACTERS } from './characters';
import { damagePlayer, knockPlayer } from './core';
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

// 협동 방어전 규칙: 웨이브 진행, 적 AI, 코어 피해, 부활.

export function createCoopState(): CoopState {
  return {
    coreHp: COOP.coreMaxHp,
    wave: 0, // 아직 첫 웨이브 전
    phase: 0, // 대기로 시작해 휴식 시간이 지나면 1웨이브가 열린다
    timer: COOP.breakTicks,
    spawnQueue: [],
    enemies: [],
    nextEnemyId: 1,
  };
}

// 이번 경기에서 뛰는 플레이어. 1인 방어면 앞의 한 명만
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
  let rushers = Math.max(1, scaled(2 + wave * 2)); // 척후병: 웨이브마다 2기씩 늘고 최소 1기
  let gunners = scaled(Math.floor(wave / 2)); // 포수: 2웨이브마다 1기씩
  let tanks = wave >= 3 ? scaled(Math.floor((wave - 1) / 2)) : 0; // 강습병: 3웨이브부터
  const queue: EnemyKind[] = [];
  // 한꺼번에 몰리지 않게 섞어 넣는다: 척후병 2 → 포수 1 → 강습병 1 반복
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

// 협동의 한 틱: 웨이브 → 적 이동·공격 → 죽은 적 정리 → 부활
export function stepCoop(state: SimState, onEvent?: SimEventSink): void {
  const coop = state.coop;
  if (!coop) return;
  stepWaves(state, coop);
  stepEnemies(state, coop, onEvent);
  coop.enemies = coop.enemies.filter((e) => e.hp > 0);
  stepRevive(state, onEvent);
}

// 웨이브 상태 기계: 0 대기 → 1 스폰 → 2 소탕 → 다시 0
function stepWaves(state: SimState, coop: CoopState): void {
  switch (coop.phase) {
    case 0: // 대기: 휴식이 끝나면 다음 웨이브의 편성을 만든다
      coop.timer -= 1;
      if (coop.timer <= 0) {
        coop.wave += 1;
        coop.spawnQueue = waveComposition(coop.wave, state.playerCount, state.difficulty);
        coop.phase = 1;
        coop.timer = 0; // 첫 적은 바로 나온다
      }
      return;
    case 1: // 스폰: 간격마다 한 기씩 꺼내 놓는다
      coop.timer -= 1;
      if (coop.timer <= 0) {
        const kind = coop.spawnQueue.shift();
        if (kind !== undefined) spawnEnemy(state, coop, kind);
        coop.timer = COOP.spawnIntervalTicks;
        if (coop.spawnQueue.length === 0) coop.phase = 2;
      }
      return;
    case 2: // 소탕: 적이 다 없어져야 다음 웨이브. 마지막 웨이브면 여기 머물고 승패 판정이 끝낸다
      if (coop.enemies.length === 0 && coop.wave < COOP.waves) {
        coop.phase = 0;
        coop.timer = COOP.breakTicks;
      }
      return;
  }
}

// 경기장 네 변 중 무작위 한 곳의 무작위 위치에서 적이 나온다
function spawnEnemy(state: SimState, coop: CoopState, kind: EnemyKind): void {
  const side = Math.floor(nextRandom(state) * 4); // 0 왼쪽, 1 오른쪽, 2 위, 3 아래
  const t = nextRandom(state); // 그 변 위의 위치 (0..1)
  const margin = ENEMIES[kind].radius; // 몸이 경기장 밖으로 나가지 않게
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
    fireCooldown: ENEMIES[kind].fireIntervalTicks, // 나오자마자 쏘지 않게 한 주기 기다린다
    contactCooldown: 0,
  });
}

// 적이 노리는 대상: 플레이어면 player가 있고, 코어면 null
interface Target {
  x: number;
  y: number;
  radius: number;
  player: PlayerState | null;
}

// 강습병은 코어만, 나머지는 가장 가까운 살아 있는 플레이어를 노린다. 다 쓰러졌으면 코어
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

// 적 AI: 상태 기계 없이 매 틱 목표를 다시 계산한다. 단순하고 결정적이다
function stepEnemies(state: SimState, coop: CoopState, onEvent?: SimEventSink): void {
  for (const e of coop.enemies) {
    const spec = ENEMIES[e.kind];
    if (e.contactCooldown > 0) e.contactCooldown -= 1;
    if (e.fireCooldown > 0) e.fireCooldown -= 1;

    const target = pickTarget(state, e);
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy) || 1; // 정확히 겹치면 0으로 나누지 않게
    const nx = dx / dist; // 목표를 향하는 단위 벡터
    const ny = dy / dist;

    // 이동: 거리를 두는 적(포수)은 너무 가까우면 물러나고, 적당하면 멈춘다
    let move = 1;
    if (spec.keepDistance > 0) {
      if (dist < spec.keepDistance - 40) move = -0.6;
      else if (dist <= spec.keepDistance + 40) move = 0;
    }
    e.x += nx * spec.speed * SIM.dt * move;
    e.y += ny * spec.speed * SIM.dt * move;

    // 접촉 공격: 몸이 닿았고 쿨다운이 끝났으면
    const reach = spec.radius + target.radius;
    if (dist <= reach && e.contactCooldown === 0) {
      e.contactCooldown = spec.contactIntervalTicks;
      const by = ENEMY_CONTACT_SOURCE[e.kind];
      if (target.player) {
        if (target.player.dashTicks === 0) {
          // 대시 중이면 피해도 넉백도 없다
          damagePlayer(state, target.player, spec.contactDamage, by, onEvent);
          // 닿으면 밀려난다. 없으면 적이 몸에 붙은 채 따라와 붙잡힌 것처럼 느껴진다
          if (target.player.hp > 0) knockPlayer(target.player, nx, ny, spec.contactKnock);
        }
      } else {
        // 코어에 닿았다
        const dealt = Math.min(coop.coreHp, spec.contactDamage);
        coop.coreHp -= dealt;
        if (dealt > 0) onEvent?.({ kind: 'core', amount: dealt, by });
      }
    }

    // 사격(포수): 사거리 안이면 목표를 향해 한 발
    if (spec.fireIntervalTicks > 0 && e.fireCooldown === 0 && dist < COOP.enemyEngageRange) {
      e.fireCooldown = spec.fireIntervalTicks;
      state.bullets.push({
        id: state.nextBulletId++,
        owner: ENEMY_OWNER,
        kind: 0,
        spawnTick: state.tick,
        lagTicks: 0, // 적 탄은 호스트가 쏘므로 되감을 필요가 없다
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

  // 적끼리 겹치지 않게 밀어낸 뒤 경기장 안에 가둔다
  separateEnemies(coop.enemies);
  for (const e of coop.enemies) {
    const r = ENEMIES[e.kind].radius;
    e.x = clamp(e.x, r, SIM.arenaW - r);
    e.y = clamp(e.y, r, SIM.arenaH - r);
  }
}

// 겹친 적 쌍을 서로 반대로 밀어낸다. 한 틱에 겹친 양의 절반의 절반만 밀어 부드럽게 풀린다
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

// 부활: 쓰러진 짝 곁에 머물면 진행도가 쌓이고, 채우면 절반 체력으로 일어난다
function stepRevive(state: SimState, onEvent?: SimEventSink): void {
  if (state.playerCount < 2) return; // 혼자 하기에는 일으켜 줄 사람이 없다
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
      // 곁을 떠나면 두 배 속도로 줄어든다. 잠깐 빠졌다 돌아오는 플레이를 막는다
      downed.reviveProgress = Math.max(0, downed.reviveProgress - 2);
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
