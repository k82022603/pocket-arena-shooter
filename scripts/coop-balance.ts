// 협동 방어전 난이도 측정: npm run check:balance
//
// 자동 플레이어로 캐릭터 x 시드 조합을 돌려 클리어율과 도달 웨이브를 낸다.
// 밸런스 수치를 건드렸을 때 "좋아진 것 같다"가 아니라 숫자로 확인하기 위한 도구다.
// 자동 플레이어는 사람보다 약하므로 절대값이 아니라 변경 전후의 차이를 본다.
import { createInitialState, outcomeOf, setPlayerLoadout, step } from '../apps/web/src/sim/core';
import { CHARACTERS, CHARACTER_ORDER, type CharacterId } from '../apps/web/src/sim/characters';
import { waveComposition } from '../apps/web/src/sim/coop';
import { COOP, EMPTY_INPUT, ENEMY_OWNER, type InputFrame, type SimState } from '../apps/web/src/sim/types';

const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];
const MAX_TICKS = 90_000;

// 적당히 잘하는 플레이어. 코어 근처를 지키고, 코어로 직행하는 강습병을 우선하고,
// 다쳤을 때만 회복팩을 주우러 가고, 날아오는 탄을 대시로 피한다.
function autoInput(s: SimState, id: 0 | 1): InputFrame {
  const me = s.players[id];
  if (me.hp <= 0 || !s.coop) return EMPTY_INPUT;

  let target: { x: number; y: number; d: number } | null = null;
  let best = Infinity;
  for (const e of s.coop.enemies) {
    const d = Math.hypot(e.x - me.x, e.y - me.y);
    const score = d * (e.kind === 2 ? 0.35 : 1);
    if (score < best) {
      best = score;
      target = { x: e.x, y: e.y, d };
    }
  }

  let aimX = 1;
  let aimY = 0;
  if (target) {
    aimX = (target.x - me.x) / target.d;
    aimY = (target.y - me.y) / target.d;
  }

  let mx = 0;
  let my = 0;
  if (target) {
    const push = target.d < 260 ? -1 : target.d > 420 ? 1 : 0;
    mx += aimX * push;
    my += aimY * push;
  }
  const cdx = COOP.coreX - me.x;
  const cdy = COOP.coreY - me.y;
  const cd = Math.hypot(cdx, cdy) || 1;
  if (cd > 340) {
    mx += (cdx / cd) * 1.2;
    my += (cdy / cd) * 1.2;
  }

  const maxHp = CHARACTERS[me.character].stats.maxHp;
  const hurt = me.hp < maxHp * 0.7;
  let pick: { x: number; y: number; d: number } | null = null;
  for (const p of s.pickups) {
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    const reach = p.kind === 0 ? (hurt ? 420 : 0) : 170;
    if (d < reach && d > 0 && (pick === null || d < pick.d)) pick = { x: p.x, y: p.y, d };
  }
  if (pick) {
    mx += ((pick.x - me.x) / pick.d) * 1.4;
    my += ((pick.y - me.y) / pick.d) * 1.4;
  }

  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }

  let dash = false;
  if (me.dashCooldown === 0 && me.dashTicks === 0) {
    for (const b of s.bullets) {
      if (b.owner !== ENEMY_OWNER) continue;
      const dx = me.x - b.x;
      const dy = me.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 170 || d === 0) continue;
      const bl = Math.hypot(b.vx, b.vy) || 1;
      if ((b.vx / bl) * (dx / d) + (b.vy / bl) * (dy / d) > 0.9) {
        dash = true;
        break;
      }
    }
    if (!dash && target && target.d < 70) dash = true;
  }

  return { moveX: mx, moveY: my, aimX, aimY, fire: target !== null && target.d < 660, dash, skill: false, swapTo: 0 };
}

function play(character: CharacterId, playerCount: 1 | 2, seed: number) {
  const s = createInitialState([character, character], { mode: 'coop', playerCount, seed });
  setPlayerLoadout(s, 0, 0);
  setPlayerLoadout(s, 1, 0);
  let out = outcomeOf(s);
  let ticks = 0;
  while (out === null && ticks < MAX_TICKS) {
    step(s, [autoInput(s, 0), playerCount === 2 ? autoInput(s, 1) : EMPTY_INPUT]);
    out = outcomeOf(s);
    ticks += 1;
  }
  return {
    won: out?.mode === 'coop' ? out.won : false,
    wave: s.coop!.wave,
    core: s.coop!.coreHp,
    secs: ticks / 60,
  };
}

const sizes = (pc: 1 | 2) => Array.from({ length: COOP.waves }, (_, i) => waveComposition(i + 1, pc).length);
const total = (pc: 1 | 2) => sizes(pc).reduce((a, b) => a + b, 0);

console.log('웨이브 편성  1인 ' + sizes(1).join('/') + '  합계 ' + total(1) + '기');
console.log('            2인 ' + sizes(2).join('/') + '  합계 ' + total(2) + '기');
console.log('시드 ' + SEEDS.length + '개 x 캐릭터 ' + CHARACTER_ORDER.length + '종, 자동 플레이\n');

for (const pc of [1, 2] as const) {
  console.log(pc === 1 ? '혼자 하기 (1인 방어)' : '2인 방어');
  let wonAll = 0;
  for (const c of CHARACTER_ORDER) {
    const rs = SEEDS.map((sd) => play(c, pc, sd));
    const wins = rs.filter((r) => r.won).length;
    wonAll += wins;
    const avgWave = rs.reduce((a, r) => a + r.wave, 0) / rs.length;
    const avgCore = rs.reduce((a, r) => a + r.core, 0) / rs.length;
    const avgSecs = rs.reduce((a, r) => a + r.secs, 0) / rs.length;
    console.log(
      '  ' + CHARACTERS[c].name.padEnd(6),
      '클리어 ' + String(wins).padStart(2) + '/' + SEEDS.length,
      ' 평균 웨이브 ' + avgWave.toFixed(1),
      ' 평균 코어 ' + String(Math.round(avgCore)).padStart(3),
      ' 평균 ' + avgSecs.toFixed(0) + '초',
    );
  }
  const runs = SEEDS.length * CHARACTER_ORDER.length;
  console.log('  전체 클리어율 ' + ((wonAll / runs) * 100).toFixed(0) + '% (' + wonAll + '/' + runs + ')\n');
}
