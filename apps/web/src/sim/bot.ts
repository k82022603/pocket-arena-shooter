import { nextRandom } from './prng';
import { EMPTY_INPUT, SIM, type InputFrame, type SimState } from './types';
import { BOT_SKILL, type BotSkill } from './difficulty';
import { WEAPONS } from './weapons';

// 혼자 하기 1:1 대전의 상대 AI. 사람처럼 보이도록 일부러 불완전하게 만들었다(조준 오차, 점사, 확률 회피).
// 사람과 똑같이 InputFrame을 만들어 내므로 시뮬레이션은 봇인지 사람인지 모른다.

// 1인 대전 상대 AI의 기억. 틱마다 botInput이 갱신한다.
export interface BotMemory {
  strafeDir: 1 | -1; // 좌우 왕복 방향
  strafeTimer: number; // 다음 방향 전환까지 남은 틱
  aimError: number; // 지금 조준 오차 (라디안)
  aimErrorTarget: number; // 오차가 천천히 다가가는 목표값
  burstTimer: number; // 점사/휴식 전환까지 남은 틱
  bursting: boolean; // 지금 쏘는 구간인가
  keepDistance: number; // 상대와 유지하려는 거리 (px)
  /** 상대의 직전 위치. 앞질러 쏠 때 속도를 어림하는 데 쓴다 */
  foeX: number;
  foeY: number;
}

export function createBotMemory(): BotMemory {
  // foeX/Y가 NaN이면 "아직 한 번도 못 봤다" (첫 틱에는 속도를 0으로 본다)
  return { strafeDir: 1, strafeTimer: 0, aimError: 0, aimErrorTarget: 0, burstTimer: 90, bursting: false, keepDistance: 360, foeX: NaN, foeY: NaN };
}

const ENGAGE_RANGE = 640; // 이 거리 안에서만 쏜다
const EDGE_MARGIN = 90; // 벽에서 이만큼 안쪽으로 머문다
const DODGE_RANGE = 220; // 이 거리 안으로 들어온 탄만 피하려고 한다
const PICKUP_RANGE = 280; // 이 거리 안의 픽업은 주우러 간다

export function botInput(state: SimState, botId: 0 | 1, mem: BotMemory, skill: BotSkill = BOT_SKILL.normal): InputFrame {
  const me = state.players[botId];
  const foe = state.players[botId === 0 ? 1 : 0];
  if (me.hp <= 0) return EMPTY_INPUT;

  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist; // 상대를 향하는 단위 벡터
  const uy = dy / dist;

  // 좌우 왕복: 1~2초마다 방향을 바꾸고 가끔 거리 취향도 바꾼다
  mem.strafeTimer -= 1;
  if (mem.strafeTimer <= 0) {
    mem.strafeDir = nextRandom(state) < 0.5 ? 1 : -1;
    mem.strafeTimer = 60 + Math.floor(nextRandom(state) * 60);
    mem.keepDistance = 280 + nextRandom(state) * 180;
  }

  // 상대 방향에 수직으로 움직이고(원을 그리며 돈다), 거리가 멀면 다가가고 가까우면 물러난다
  let moveX = -uy * mem.strafeDir;
  let moveY = ux * mem.strafeDir;
  const approach = dist > mem.keepDistance + 40 ? 1 : dist < mem.keepDistance - 40 ? -0.8 : 0;
  moveX += ux * approach;
  moveY += uy * approach;

  // 가까운 픽업이 있으면 그쪽으로
  let nearest: { x: number; y: number; d: number } | null = null;
  for (const pk of state.pickups) {
    const d = Math.hypot(pk.x - me.x, pk.y - me.y);
    if (d < PICKUP_RANGE && (!nearest || d < nearest.d)) nearest = { x: pk.x, y: pk.y, d };
  }
  if (nearest) {
    moveX = (nearest.x - me.x) / nearest.d;
    moveY = (nearest.y - me.y) / nearest.d;
  }

  // 벽 근처에서는 안쪽으로 민다
  if (me.x < EDGE_MARGIN) moveX += 1;
  if (me.x > SIM.arenaW - EDGE_MARGIN) moveX -= 1;
  if (me.y < EDGE_MARGIN) moveY += 1;
  if (me.y > SIM.arenaH - EDGE_MARGIN) moveY -= 1;
  // 여러 방향을 더해 길이가 1을 넘으면 1로 줄인다 (스틱을 끝까지 민 것과 같게)
  const len = Math.hypot(moveX, moveY);
  if (len > 1) {
    moveX /= len;
    moveY /= len;
  }

  // 나를 향해 날아오는 탄이 가까우면 대시로 회피
  let dash = false;
  if (me.dashCooldown === 0) {
    for (const b of state.bullets) {
      if (b.owner === botId) continue; // 내 탄은 무시
      const bx = me.x - b.x;
      const by = me.y - b.y;
      const bd = Math.hypot(bx, by);
      if (bd > DODGE_RANGE) continue;
      const speed = Math.hypot(b.vx, b.vy) || 1;
      // 탄 진행 방향과 "탄 → 나" 방향의 코사인. 0.94면 약 20도 안쪽으로 나를 향해 온다
      const toward = (bx * b.vx + by * b.vy) / (bd * speed);
      if (toward > 0.94 && nextRandom(state) < skill.dodgeChance) {
        dash = true;
        break;
      }
    }
  }

  // 조준: 난이도만큼 상대 이동을 앞지르고, 천천히 흔들리는 오차를 더한다
  const fvx = Number.isNaN(mem.foeX) ? 0 : foe.x - mem.foeX; // 상대의 틱당 이동량 (속도 어림)
  const fvy = Number.isNaN(mem.foeY) ? 0 : foe.y - mem.foeY;
  mem.foeX = foe.x;
  mem.foeY = foe.y;
  const flightTicks = (dist / WEAPONS[me.weapon].speed) * SIM.tickRate * skill.lead; // 탄이 닿는 데 걸리는 틱 × 앞지르는 정도
  const baseAngle = Math.atan2(foe.y + fvy * flightTicks - me.y, foe.x + fvx * flightTicks - me.x);
  // 오차가 목표에 거의 닿으면 새 목표를 뽑는다. 오차는 목표를 향해 5%씩 다가간다(손이 천천히 흔들리는 느낌)
  if (Math.abs(mem.aimError - mem.aimErrorTarget) < 0.01) mem.aimErrorTarget = (nextRandom(state) - 0.5) * skill.aimError;
  mem.aimError += (mem.aimErrorTarget - mem.aimError) * 0.05;
  const angle = baseAngle + mem.aimError;

  // 점사: 정해진 만큼 쏘고 잠깐 쉰다 (보통은 0.5초 쏘고 0.5~1초 쉼)
  mem.burstTimer -= 1;
  if (mem.burstTimer <= 0) {
    mem.bursting = !mem.bursting;
    mem.burstTimer = mem.bursting ? skill.burstTicks : skill.restMin + Math.floor(nextRandom(state) * skill.restSpread);
  }
  const fire = mem.bursting && dist < ENGAGE_RANGE && foe.hp > 0;

  return { moveX, moveY, aimX: Math.cos(angle), aimY: Math.sin(angle), fire, dash, skill: false, swapTo: 0 };
}
