import type Phaser from 'phaser';
import type { CharacterId } from '../../sim/characters';

// 원작에서 한눈에 구분되는 특징으로 실루엣을 나눈다.
//  winged  라키시스 — 크게 벌어진 스파이크 견장
//  mane    클로소   — 뒤로 거대하게 퍼지는 머리카락
//  bob     아트로포스 — 짧은 단발과 각진 견장
//  hood    에스트   — 머리를 감싼 오렌지 후드
export type Silhouette = 'winged' | 'mane' | 'bob' | 'hood';

export interface FatimaLook {
  hair: number;
  hairHighlight: number;
  suit: number;
  suitDark: number;
  accent: number;
  skin: number;
  hairLength: number;
  hairWidth: number;
  silhouette: Silhouette;
  // 이마의 푸른 보석 (운명의 세 여신 공통)
  gem: boolean;
}

export const LOOKS: Record<CharacterId, FatimaLook> = {
  lachesis: {
    hair: 0x14121e,
    hairHighlight: 0x3d3762,
    suit: 0xd42a33,
    suitDark: 0x7f1219,
    accent: 0xf7f3ee,
    skin: 0xf5dccb,
    hairLength: 44,
    hairWidth: 18,
    silhouette: 'winged',
    gem: true,
  },
  clotho: {
    hair: 0x14121e,
    hairHighlight: 0x3d3762,
    suit: 0xcf2038,
    suitDark: 0x7a1020,
    accent: 0xf7f3ee,
    skin: 0xf5dccb,
    hairLength: 62,
    hairWidth: 44,
    silhouette: 'mane',
    gem: true,
  },
  atropos: {
    hair: 0x14121e,
    hairHighlight: 0x3d3762,
    suit: 0xe23a6e,
    suitDark: 0x2a1020,
    accent: 0xf7f3ee,
    skin: 0xf5dccb,
    hairLength: 13,
    hairWidth: 26,
    silhouette: 'bob',
    gem: true,
  },
  est: {
    hair: 0x5b3a25,
    hairHighlight: 0x8a5e3c,
    suit: 0x1b1720,
    suitDark: 0x0c0a10,
    accent: 0xff8a1f,
    skin: 0xf5dccb,
    hairLength: 30,
    hairWidth: 18,
    silhouette: 'hood',
    gem: false,
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
  const along = (a: number, side: number): Pt => ({
    x: pose.x + (pose.trailX * a + rx * side) * s,
    y: pose.y + (pose.trailY * a + ry * side) * s,
  });
  const sway = Math.sin(pose.time / 140) * 3 + Math.sin(pose.time / 310) * 2;

  drawHair(g, look, pose, along, sway, color, alpha);
  drawShoulders(g, look, at, s, color, alpha);
  drawBody(g, look, at, s, color, alpha);
  drawArmAndGun(g, look, at, s, flash, color, alpha);
  drawHead(g, look, at, s, flash, color, alpha);
}

function drawHair(
  g: Phaser.GameObjects.Graphics,
  look: FatimaLook,
  pose: FatimaPose,
  along: (a: number, side: number) => Pt,
  sway: number,
  color: (c: number) => number,
  alpha: number,
): void {
  const hw = look.hairWidth;
  const hl = look.hairLength;
  g.fillStyle(color(look.hair), alpha);

  if (look.silhouette === 'mane') {
    // 거대한 부채꼴로 퍼지며 끝이 들쭉날쭉한 머리카락
    const points: Pt[] = [along(2, -hw * 0.3)];
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const side = (t - 0.5) * 2;
      const taper = 0.5 + 0.5 * Math.cos(side * 1.25);
      const jag = i % 2 === 0 ? 8 : -5;
      points.push(along(hl * taper + jag, side * hw + sway * (0.3 + t * 0.4)));
    }
    points.push(along(2, hw * 0.3));
    g.fillPoints(points, true);
    g.fillStyle(color(look.hairHighlight), alpha * 0.35);
    g.fillPoints([along(4, -hw * 0.1), along(hl * 0.55, -hw * 0.25 + sway * 0.4), along(hl * 0.7, sway), along(hl * 0.5, hw * 0.15)], true);
    return;
  }

  if (look.silhouette === 'bob') {
    // 짧은 단발: 머리 뒤만 감싸는 둥근 덩어리
    g.fillPoints(
      [
        along(1, -hw * 0.5),
        along(hl * 0.8, -hw * 0.42),
        along(hl, -hw * 0.15 + sway * 0.2),
        along(hl, hw * 0.15 + sway * 0.2),
        along(hl * 0.8, hw * 0.42),
        along(1, hw * 0.5),
      ],
      true,
    );
    return;
  }

  // 길게 흐르는 생머리 (라키시스·에스트)
  g.fillPoints(
    [
      along(2, -hw * 0.5),
      along(hl * 0.35, -hw * 0.55 + sway * 0.3),
      along(hl * 0.7, -hw * 0.4 + sway * 0.7),
      along(hl, sway),
      along(hl * 0.7, hw * 0.4 + sway * 0.7),
      along(hl * 0.35, hw * 0.55 + sway * 0.3),
      along(2, hw * 0.5),
    ],
    true,
  );
  g.fillStyle(color(look.hairHighlight), alpha * 0.45);
  g.fillPoints([along(4, -hw * 0.12), along(hl * 0.5, -hw * 0.18 + sway * 0.5), along(hl * 0.85, sway * 0.9), along(hl * 0.5, hw * 0.08)], true);
}

function drawShoulders(
  g: Phaser.GameObjects.Graphics,
  look: FatimaLook,
  at: (a: number, b: number) => Pt,
  s: number,
  color: (c: number) => number,
  alpha: number,
): void {
  if (look.silhouette === 'winged') {
    // 크게 벌어진 견장과 바깥 테두리의 스파이크
    for (const dir of [-1, 1]) {
      const base = at(5, dir * 7);
      const inner = at(-7, dir * 8);
      const tip = at(-1, dir * 23);
      g.fillStyle(color(look.suit), alpha);
      g.fillTriangle(base.x, base.y, inner.x, inner.y, tip.x, tip.y);
      g.lineStyle(1.2 * s, color(look.suitDark), alpha);
      g.strokeTriangle(base.x, base.y, inner.x, inner.y, tip.x, tip.y);
      g.fillStyle(color(look.accent), alpha * 0.9);
      for (const t of [0.35, 0.6, 0.85]) {
        const a = 5 + (-1 - 5) * t;
        const b = dir * (7 + (23 - 7) * t);
        const p = at(a, b);
        g.fillCircle(p.x, p.y, 1.3 * s);
      }
    }
    return;
  }

  if (look.silhouette === 'bob') {
    // 각진 사각 견장
    for (const dir of [-1, 1]) {
      const pts = [at(6, dir * 7), at(6, dir * 18), at(-7, dir * 17), at(-7, dir * 7)];
      g.fillStyle(color(look.suit), alpha);
      g.fillPoints(pts, true);
      g.lineStyle(1.2 * s, color(look.suitDark), alpha);
      g.strokePoints(pts, true, true);
    }
  }
}

function drawBody(
  g: Phaser.GameObjects.Graphics,
  look: FatimaLook,
  at: (a: number, b: number) => Pt,
  s: number,
  color: (c: number) => number,
  alpha: number,
): void {
  const body: Pt[] = [at(11, 0), at(8, 7), at(1, 13), at(-8, 10), at(-11, 0), at(-8, -10), at(1, -13), at(8, -7)];
  g.fillStyle(color(look.suit), alpha);
  g.fillPoints(body, true);
  g.lineStyle(1.5 * s, color(look.suitDark), alpha);
  g.strokePoints(body, true, true);

  // 흰 소매
  g.fillStyle(color(look.accent), alpha * 0.95);
  g.fillPoints([at(3, 9), at(-4, 13), at(-8, 10), at(-3, 7)], true);
  g.fillPoints([at(3, -9), at(-4, -13), at(-8, -10), at(-3, -7)], true);

  // 가운데 패널 — 아트로포스는 검은 패널이 넓어 핑크 제복과 대비된다
  g.fillStyle(color(look.suitDark), alpha * 0.9);
  const panel = look.silhouette === 'bob' ? 4 : 2.5;
  g.fillPoints([at(9, 0), at(3, panel), at(-8, panel), at(-8, -panel), at(3, -panel)], true);
}

function drawArmAndGun(
  g: Phaser.GameObjects.Graphics,
  look: FatimaLook,
  at: (a: number, b: number) => Pt,
  s: number,
  flash: boolean,
  color: (c: number) => number,
  alpha: number,
): void {
  const gunStart = at(3, 8);
  const gunEnd = at(27, 6);
  const shoulder = at(-2, 10);
  g.lineStyle(4 * s, color(look.accent), alpha);
  g.lineBetween(shoulder.x, shoulder.y, gunStart.x, gunStart.y);
  g.lineStyle(5 * s, flash ? 0xffffff : 0x2b2f3a, alpha);
  g.lineBetween(gunStart.x, gunStart.y, gunEnd.x, gunEnd.y);
  g.lineStyle(2 * s, color(look.hairHighlight), alpha);
  const tip = at(22, 6);
  g.lineBetween(tip.x, tip.y, gunEnd.x, gunEnd.y);
}

function drawHead(
  g: Phaser.GameObjects.Graphics,
  look: FatimaLook,
  at: (a: number, b: number) => Pt,
  s: number,
  flash: boolean,
  color: (c: number) => number,
  alpha: number,
): void {
  const face = at(4.5, 0);
  const crown = at(0.5, 0);

  if (look.silhouette === 'hood') {
    // 머리를 감싸는 오렌지 후드와 흰 크라바트
    g.fillStyle(color(look.accent), alpha);
    g.fillPoints([at(3, -12), at(-9, -13), at(-14, 0), at(-9, 13), at(3, 12), at(7, 0)], true);
    g.fillStyle(color(look.skin), alpha);
    g.fillCircle(face.x, face.y, 6.5 * s);
    g.fillStyle(color(look.hair), alpha * 0.9);
    g.fillCircle(crown.x, crown.y, 6 * s);
    g.fillStyle(flash ? 0xffffff : 0xf7f3ee, alpha);
    const a = at(9, -3.5);
    const b = at(9, 3.5);
    const c = at(14, 0);
    g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    return;
  }

  g.fillStyle(color(look.skin), alpha);
  g.fillCircle(face.x, face.y, 7 * s);
  g.fillStyle(color(look.hair), alpha);
  g.fillCircle(crown.x, crown.y, 8.5 * s);
  g.fillStyle(color(look.hairHighlight), alpha * 0.5);
  const hl = at(-1, -3);
  g.fillCircle(hl.x, hl.y, 3 * s);

  if (look.gem) {
    const gem = at(8, 0);
    g.fillStyle(0x4cc9f0, alpha * 0.35);
    g.fillCircle(gem.x, gem.y, 4.5 * s);
    g.fillStyle(flash ? 0xffffff : 0x7fe3ff, alpha);
    g.fillPoints([at(11, 0), at(8, 2.2), at(5.5, 0), at(8, -2.2)], true);
  }
}
