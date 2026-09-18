import type Phaser from 'phaser';
import type { CharacterId } from '../../sim/characters';

// gem: 이마의 푸른 보석(운명의 세 여신 공통), hood: 흑기사 시절 에스트의 오렌지 후드
export type Headdress = 'gem' | 'hood';

export interface FatimaLook {
  hair: number;
  hairHighlight: number;
  suit: number;
  suitDark: number;
  accent: number;
  skin: number;
  hairLength: number;
  hairWidth: number;
  headdress: Headdress;
}

// 원작 일러스트 기준: 세 자매는 흑발에 빨간 파티마 제복(흰 소매), 에스트는 갈색 머리·검은 슈트·오렌지 후드.
export const LOOKS: Record<CharacterId, FatimaLook> = {
  lachesis: {
    hair: 0x14121e,
    hairHighlight: 0x3d3762,
    suit: 0xd42a33,
    suitDark: 0x7f1219,
    accent: 0xf7f3ee,
    skin: 0xf5dccb,
    hairLength: 46,
    hairWidth: 20,
    headdress: 'gem',
  },
  clotho: {
    hair: 0x14121e,
    hairHighlight: 0x3d3762,
    suit: 0xcf2038,
    suitDark: 0x7a1020,
    accent: 0xf7f3ee,
    skin: 0xf5dccb,
    hairLength: 58,
    hairWidth: 36,
    headdress: 'gem',
  },
  atropos: {
    hair: 0x14121e,
    hairHighlight: 0x3d3762,
    suit: 0xe23a6e,
    suitDark: 0x8a1d40,
    accent: 0xf7f3ee,
    skin: 0xf5dccb,
    hairLength: 16,
    hairWidth: 28,
    headdress: 'gem',
  },
  est: {
    hair: 0x5b3a25,
    hairHighlight: 0x8a5e3c,
    suit: 0x1b1720,
    suitDark: 0x0c0a10,
    accent: 0xff8a1f,
    skin: 0xf5dccb,
    hairLength: 34,
    hairWidth: 18,
    headdress: 'hood',
  },
};

export interface FatimaPose {
  x: number;
  y: number;
  aim: number;
  // 머리카락이 흘러가는 방향(단위 벡터). 보통 조준 반대·이동 반대를 섞는다.
  trailX: number;
  trailY: number;
  time: number;
  scale: number;
  alpha: number;
  flash: boolean;
}

type Pt = { x: number; y: number };

export function drawFatima(g: Phaser.GameObjects.Graphics, look: FatimaLook, pose: FatimaPose): void {
  const s = pose.scale;
  const fx = Math.cos(pose.aim);
  const fy = Math.sin(pose.aim);
  const rx = -fy;
  const ry = fx;
  const at = (a: number, b: number): Pt => ({ x: pose.x + (fx * a + rx * b) * s, y: pose.y + (fy * a + ry * b) * s });
  const flash = pose.flash;
  const color = (c: number) => (flash ? 0xffffff : c);
  const alpha = pose.alpha;

  const tx = pose.trailX;
  const ty = pose.trailY;
  const along = (a: number, side: number): Pt => ({
    x: pose.x + (tx * a + rx * side) * s,
    y: pose.y + (ty * a + ry * side) * s,
  });
  const sway = Math.sin(pose.time / 140) * 3 + Math.sin(pose.time / 310) * 2;

  // 머리카락 (뒤로 흐르는 형태)
  const hw = look.hairWidth;
  const hl = look.hairLength;
  const hair: Pt[] = [
    along(2, -hw * 0.5),
    along(hl * 0.35, -hw * 0.6 + sway * 0.3),
    along(hl * 0.7, -hw * 0.45 + sway * 0.7),
    along(hl, sway),
    along(hl * 0.7, hw * 0.45 + sway * 0.7),
    along(hl * 0.35, hw * 0.6 + sway * 0.3),
    along(2, hw * 0.5),
  ];
  g.fillStyle(color(look.hair), alpha);
  g.fillPoints(hair, true);
  g.fillStyle(color(look.hairHighlight), alpha * 0.45);
  g.fillPoints(
    [along(4, -hw * 0.12), along(hl * 0.5, -hw * 0.18 + sway * 0.5), along(hl * 0.85, sway * 0.9), along(hl * 0.5, hw * 0.08 + sway * 0.5)],
    true,
  );

  if (look.headdress === 'hood') {
    // 후드: 머리 뒤를 감싸는 오렌지 덮개
    g.fillStyle(color(look.accent), alpha);
    g.fillPoints([at(2, -12), at(-9, -13), at(-14, -6), at(-14, 6), at(-9, 13), at(2, 12)], true);
  }

  // 몸통(슈트) — 조준 방향을 향한 팔각 캡슐, 어깨는 각진 견장 느낌
  const body: Pt[] = [at(11, 0), at(8, 7), at(1, 14), at(-8, 11), at(-11, 0), at(-8, -11), at(1, -14), at(8, -7)];
  g.fillStyle(color(look.suit), alpha);
  g.fillPoints(body, true);
  g.lineStyle(1.5 * s, color(look.suitDark), alpha);
  g.strokePoints(body, true, true);
  // 흰 소매/어깨 라인
  g.fillStyle(color(look.accent), alpha * 0.95);
  g.fillPoints([at(3, 9), at(-4, 14), at(-8, 11), at(-3, 7)], true);
  g.fillPoints([at(3, -9), at(-4, -14), at(-8, -11), at(-3, -7)], true);
  g.fillStyle(color(look.suitDark), alpha * 0.9);
  g.fillPoints([at(9, 0), at(3, 2.5), at(-8, 2.5), at(-8, -2.5), at(3, -2.5)], true);

  // 팔과 총
  const gunStart = at(3, 8);
  const gunEnd = at(27, 6);
  const shoulder = at(-2, 10);
  g.lineStyle(4 * s, color(look.accent), alpha);
  g.lineBetween(shoulder.x, shoulder.y, gunStart.x, gunStart.y);
  g.lineStyle(5 * s, flash ? 0xffffff : 0x2b2f3a, alpha);
  g.lineBetween(gunStart.x, gunStart.y, gunEnd.x, gunEnd.y);
  g.lineStyle(2 * s, color(look.hairHighlight), alpha);
  const tipA = at(22, 6);
  g.lineBetween(tipA.x, tipA.y, gunEnd.x, gunEnd.y);

  // 머리: 앞쪽 피부 초승달 + 뒤쪽 머리카락 원
  const face = at(4.5, 0);
  g.fillStyle(color(look.skin), alpha);
  g.fillCircle(face.x, face.y, 7 * s);
  const crown = at(0.5, 0);
  g.fillStyle(color(look.hair), alpha);
  g.fillCircle(crown.x, crown.y, 8.5 * s);
  g.fillStyle(color(look.hairHighlight), alpha * 0.5);
  const hl2 = at(-1, -3);
  g.fillCircle(hl2.x, hl2.y, 3 * s);

  if (look.headdress === 'gem') {
    const gem = at(8, 0);
    g.fillStyle(0x4cc9f0, alpha * 0.35);
    g.fillCircle(gem.x, gem.y, 4.5 * s);
    g.fillStyle(flash ? 0xffffff : 0x7fe3ff, alpha);
    const p1 = at(11, 0);
    const p2 = at(8, 2.2);
    const p3 = at(5.5, 0);
    const p4 = at(8, -2.2);
    g.fillPoints([p1, p2, p3, p4], true);
  } else {
    // 후드 앞자락과 흰 크라바트
    g.fillStyle(color(look.accent), alpha);
    g.fillPoints([at(2, 12), at(-4, 12), at(-4, -12), at(2, -12), at(6, -9), at(6, 9)], true);
    g.fillStyle(color(look.skin), alpha);
    g.fillCircle(face.x, face.y, 7 * s);
    g.fillStyle(color(look.hair), alpha * 0.9);
    g.fillCircle(crown.x, crown.y, 6.5 * s);
    g.fillStyle(flash ? 0xffffff : 0xf7f3ee, alpha);
    g.fillTriangle(at(9, -3).x, at(9, -3).y, at(9, 3).x, at(9, 3).y, at(14, 0).x, at(14, 0).y);
  }
}
