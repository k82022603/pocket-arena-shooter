// 조준 보정. 조준 방향 앞 ASSIST_DEG 안에 적이 있으면 그 적을 향해 쏜다.
//
// 측정해 보니 초반 난이도를 가르는 것은 적의 수가 아니라 조준이었다. 사람의 손 조준(명중률 10% 안팎)으로
// 가만히 서서 쏘면 1인 방어 '하'에서도 40%가 1웨이브에서 쓰러졌고, 18도 보정을 넣으면 1%로 떨어졌다.
//
// 게임 규칙(sim)은 건드리지 않고 입력 단계에서 조준 방향만 바꿔 보낸다. 그래서 둘이 할 때도
// 각자 자기 화면에 보이는 적을 기준으로 동작한다. 사람끼리의 1:1 대전에는 쓰지 않는다.
// Phaser를 쓰지 않는 순수 함수라 화면 없이 검사한다.

export const ASSIST_DEG = 18;
/** 이보다 먼 적은 보정하지 않는다(월드 px). 기본 탄이 날아가는 거리 안쪽 */
export const ASSIST_RANGE = 900;

export interface AssistTarget {
  x: number;
  y: number;
}

export interface AssistResult {
  aimX: number;
  aimY: number;
  /** 보정 대상의 목록 번호. 없으면 -1 */
  index: number;
}

/**
 * (ox, oy)에서 (aimX, aimY) 방향으로 조준할 때, 각도 차이가 가장 작은 적이 ASSIST_DEG 안에 있으면
 * 그 적을 향한 단위 벡터를 돌려준다. 없으면 조준을 그대로 돌려준다.
 */
export function assistAim(
  ox: number,
  oy: number,
  aimX: number,
  aimY: number,
  targets: readonly AssistTarget[],
  deg = ASSIST_DEG,
  range = ASSIST_RANGE,
): AssistResult {
  const len = Math.hypot(aimX, aimY);
  if (len === 0) return { aimX, aimY, index: -1 };
  const aim = Math.atan2(aimY, aimX);
  const limit = (deg * Math.PI) / 180;
  let best = -1;
  let bestDiff = limit;
  targets.forEach((t, i) => {
    const dx = t.x - ox;
    const dy = t.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist > range) return;
    const diff = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - aim), Math.cos(Math.atan2(dy, dx) - aim)));
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  if (best < 0) return { aimX, aimY, index: -1 };
  const t = targets[best]!;
  const d = Math.hypot(t.x - ox, t.y - oy);
  return { aimX: (t.x - ox) / d, aimY: (t.y - oy) / d, index: best };
}
