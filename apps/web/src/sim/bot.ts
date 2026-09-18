import { nextRandom } from './prng';
import { EMPTY_INPUT, SIM, type InputFrame, type SimState } from './types';

// 1인 대전 상대 AI의 기억. 틱마다 botInput이 갱신한다.
export interface BotMemory {
  strafeDir: 1 | -1;
  strafeTimer: number;
  aimError: number;
  aimErrorTarget: number;
  burstTimer: number;
  bursting: boolean;
  keepDistance: number;
}

export function createBotMemory(): BotMemory {
  return { strafeDir: 1, strafeTimer: 0, aimError: 0, aimErrorTarget: 0, burstTimer: 90, bursting: false, keepDistance: 360 };
}

const ENGAGE_RANGE = 640;
const EDGE_MARGIN = 90;
const DODGE_RANGE = 220;
const PICKUP_RANGE = 280;

export function botInput(state: SimState, botId: 0 | 1, mem: BotMemory): InputFrame {
  const me = state.players[botId];
  const foe = state.players[botId === 0 ? 1 : 0];
  if (me.hp <= 0) return EMPTY_INPUT;

  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  // 좌우 왕복: 1~2초마다 방향을 바꾸고 가끔 거리 취향도 바꾼다
  mem.strafeTimer -= 1;
  if (mem.strafeTimer <= 0) {
    mem.strafeDir = nextRandom(state) < 0.5 ? 1 : -1;
    mem.strafeTimer = 60 + Math.floor(nextRandom(state) * 60);
    mem.keepDistance = 280 + nextRandom(state) * 180;
  }

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
  const len = Math.hypot(moveX, moveY);
  if (len > 1) {
    moveX /= len;
    moveY /= len;
  }

  // 나를 향해 날아오는 탄이 가까우면 대시로 회피
  let dash = false;
  if (me.dashCooldown === 0) {
    for (const b of state.bullets) {
      if (b.owner === botId) continue;
      const bx = me.x - b.x;
      const by = me.y - b.y;
      const bd = Math.hypot(bx, by);
      if (bd > DODGE_RANGE) continue;
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const toward = (bx * b.vx + by * b.vy) / (bd * speed);
      if (toward > 0.94 && nextRandom(state) < 0.35) {
        dash = true;
        break;
      }
    }
  }

  // 조준: 탄속에 맞춰 상대 이동을 약간 앞지르고, 천천히 흔들리는 오차를 더한다
  const baseAngle = Math.atan2(foe.y - me.y, foe.x - me.x);
  if (Math.abs(mem.aimError - mem.aimErrorTarget) < 0.01) mem.aimErrorTarget = (nextRandom(state) - 0.5) * 0.36;
  mem.aimError += (mem.aimErrorTarget - mem.aimError) * 0.05;
  const angle = baseAngle + mem.aimError;

  // 점사: 0.5초 쏘고 0.5~1초 쉰다
  mem.burstTimer -= 1;
  if (mem.burstTimer <= 0) {
    mem.bursting = !mem.bursting;
    mem.burstTimer = mem.bursting ? 30 : 30 + Math.floor(nextRandom(state) * 30);
  }
  const fire = mem.bursting && dist < ENGAGE_RANGE && foe.hp > 0;

  return { moveX, moveY, aimX: Math.cos(angle), aimY: Math.sin(angle), fire, dash, skill: false };
}
