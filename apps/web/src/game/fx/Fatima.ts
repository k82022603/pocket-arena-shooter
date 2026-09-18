import type Phaser from 'phaser';
import type { CharacterId } from '../../sim/characters';

export type Headdress = 'halo' | 'veil' | 'tiara' | 'ribbon';

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

// 색·머리 모양은 게임 해석. 원작 일러스트를 복제하지 않고 실루엣 문법만 가져온다.
export const LOOKS: Record<CharacterId, FatimaLook> = {
  lachesis: {
    hair: 0xf2d16b,
    hairHighlight: 0xfff3bf,
    suit: 0x2b2f4a,
    suitDark: 0x1a1d30,
    accent: 0xf5c542,
    skin: 0xf7dcc8,
    hairLength: 42,
    hairWidth: 22,
    headdress: 'halo',
  },
  clotho: {
    hair: 0xdff6ff,
    hairHighlight: 0xffffff,
    suit: 0x1f3b5c,
    suitDark: 0x122436,
    accent: 0x7fd7ff,
    skin: 0xf7dcc8,
    hairLength: 48,
    hairWidth: 16,
    headdress: 'veil',
  },
  atropos: {
    hair: 0x3a2a55,
    hairHighlight: 0x8a6fc0,
    suit: 0x3d1f3a,
    suitDark: 0x241222,
    accent: 0xf472b6,
    skin: 0xf3d5c4,
    hairLength: 28,
    hairWidth: 22,
    headdress: 'tiara',
  },
  est: {
    hair: 0x1e1b2e,
    hairHighlight: 0x4f4870,
    suit: 0xff8c42,
    suitDark: 0xb85a1f,
    accent: 0xffd29d,
    skin: 0xf7dcc8,
    hairLength: 34,
    hairWidth: 18,
    headdress: 'ribbon',
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
    along(hl * 0.7, -hw * 0.4 + sway * 0.7),
    along(hl, sway),
    along(hl * 0.7, hw * 0.4 + sway * 0.7),
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

  if (look.headdress === 'veil') {
    for (const side of [-1, 1]) {
      const wob = Math.sin(pose.time / 120 + side) * 4;
      g.fillStyle(color(look.accent), alpha * 0.85);
      g.fillPoints(
        [
          along(0, side * 8),
          along(hl * 0.6, side * (hw * 0.5 + 6) + wob),
          along(hl * 1.15, side * (hw * 0.35 + 4) + wob * 1.5),
          along(hl * 0.6, side * (hw * 0.5 + 2) + wob),
        ],
        true,
      );
    }
  }

  // 몸통(슈트) — 조준 방향을 향한 팔각 캡슐
  const body: Pt[] = [at(11, 0), at(8, 7), at(0, 13), at(-8, 10), at(-11, 0), at(-8, -10), at(0, -13), at(8, -7)];
  g.fillStyle(color(look.suit), alpha);
  g.fillPoints(body, true);
  g.lineStyle(1.5 * s, color(look.suitDark), alpha);
  g.strokePoints(body, true, true);
  g.fillStyle(color(look.accent), alpha * 0.9);
  g.fillPoints([at(10, 0), at(4, 3), at(-8, 3), at(-8, -3), at(4, -3)], true);

  // 팔과 총
  const gunStart = at(3, 8);
  const gunEnd = at(27, 6);
  const shoulder = at(-2, 10);
  g.lineStyle(4 * s, color(look.suitDark), alpha);
  g.lineBetween(shoulder.x, shoulder.y, gunStart.x, gunStart.y);
  g.lineStyle(5 * s, flash ? 0xffffff : 0x2b2f3a, alpha);
  g.lineBetween(gunStart.x, gunStart.y, gunEnd.x, gunEnd.y);
  g.lineStyle(2 * s, color(look.accent), alpha);
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

  switch (look.headdress) {
    case 'halo': {
      g.lineStyle(4 * s, color(look.accent), alpha * 0.25);
      g.strokeCircle(crown.x, crown.y, 14 * s);
      g.lineStyle(1.8 * s, color(look.accent), alpha * 0.95);
      g.strokeCircle(crown.x, crown.y, 12.5 * s);
      break;
    }
    case 'tiara': {
      g.fillStyle(color(look.accent), alpha);
      for (const side of [-5, 0, 5]) {
        const b1 = at(6, side - 2);
        const b2 = at(6, side + 2);
        const tip = at(side === 0 ? 13 : 11, side);
        g.fillTriangle(b1.x, b1.y, b2.x, b2.y, tip.x, tip.y);
      }
      break;
    }
    case 'ribbon': {
      g.fillStyle(color(look.accent), alpha);
      const knot = at(-7, 0);
      for (const side of [-1, 1]) {
        const a = at(-6, side * 3);
        const b = at(-13, side * 9);
        const c = at(-10, side * 2);
        g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      }
      g.fillCircle(knot.x, knot.y, 2.2 * s);
      break;
    }
    case 'veil':
      g.lineStyle(1.5 * s, color(look.accent), alpha * 0.9);
      g.strokeCircle(crown.x, crown.y, 9.5 * s);
      break;
  }
}
