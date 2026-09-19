import type Phaser from 'phaser';
import type { CharacterId } from '../../sim/characters';

// 원작에서 한눈에 구분되는 특징으로 실루엣을 나눈다.
//  winged  라키시스 — 크게 벌어진 스파이크 견장
//  mane    클로소   — 뒤로 거대하게 퍼지는 머리카락
//  bob     아트로포스 — 짧은 단발과 각진 견장
//  hood    에스트   — 머리를 감싼 오렌지 후드
export type Silhouette = 'winged' | 'mane' | 'bob' | 'hood';

// 게임 안의 파티마는 스프라이트 없이 도형 명령으로 그린다. 이 파일이 그 그림 전부다.

export interface FatimaLook {
  hair: number; // 머리색
  hairHighlight: number; // 머리 광택
  suit: number; // 제복 주색
  suitDark: number; // 제복 윤곽·어두운 부분
  accent: number; // 소매·견장 장식 (에스트는 후드)
  skin: number;
  hairLength: number; // 머리가 뒤로 흐르는 길이 (px, 배율 1 기준)
  hairWidth: number; // 머리 폭
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
  x: number; // 몸 중심 (경기장 좌표)
  y: number;
  aim: number; // 조준 각도 = 몸이 향한 방향 (라디안)
  // 머리카락이 흘러가는 방향(단위 벡터). 보통 조준 반대·이동 반대를 섞는다.
  trailX: number;
  trailY: number;
  time: number; // 머리 흔들림 애니메이션 시각 (ms)
  scale: number; // 크기 배율
  alpha: number; // 투명도 (다운되면 흐리게)
  flash: boolean; // 피격 중: 전부 흰색으로
}

type Pt = { x: number; y: number };

// 뒤에서 앞 순서로 겹쳐 그린다: 머리카락 → 견장 → 몸 → 팔·총 → 머리
export function drawFatima(g: Phaser.GameObjects.Graphics, look: FatimaLook, pose: FatimaPose): void {
  const s = pose.scale;
  const fx = Math.cos(pose.aim); // 앞쪽 단위 벡터
  const fy = Math.sin(pose.aim);
  const rx = -fy; // 오른쪽 단위 벡터 (앞에 수직)
  const ry = fx;
  // 캐릭터 기준 좌표(a 앞쪽, b 옆쪽) → 경기장 좌표. 조준 방향으로 몸 전체가 돈다
  const at = (a: number, b: number): Pt => ({ x: pose.x + (fx * a + rx * b) * s, y: pose.y + (fy * a + ry * b) * s });
  const flash = pose.flash;
  const color = (c: number) => (flash ? 0xffffff : c); // 피격 중에는 모든 색을 흰색으로
  const alpha = pose.alpha;
  // 머리카락 기준 좌표: 앞쪽 대신 흘러가는 방향(trail)을 축으로 쓴다
  const along = (a: number, side: number): Pt => ({
    x: pose.x + (pose.trailX * a + rx * side) * s,
    y: pose.y + (pose.trailY * a + ry * side) * s,
  });
  const sway = Math.sin(pose.time / 140) * 3 + Math.sin(pose.time / 310) * 2; // 주기가 다른 두 사인을 섞어 규칙적이지 않게 흔들린다

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
    const steps = 9; // 끝단을 이만큼의 뾰족한 가닥으로 나눈다
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const side = (t - 0.5) * 2; // -1(왼쪽 끝)..1(오른쪽 끝)
      const taper = 0.5 + 0.5 * Math.cos(side * 1.25); // 가운데가 가장 길고 양옆으로 짧아진다
      const jag = i % 2 === 0 ? 8 : -5; // 가닥 끝을 번갈아 길고 짧게
      points.push(along(hl * taper + jag, side * hw + sway * (0.3 + t * 0.4)));
    }
    points.push(along(2, hw * 0.3));
    g.fillPoints(points, true);
    g.fillStyle(color(look.hairHighlight), alpha * 0.35); // 광택 한 줄
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
        // 견장 바깥 모서리(base→tip)를 따라 흰 점 세 개
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
  const body: Pt[] = [at(11, 0), at(8, 7), at(1, 13), at(-8, 10), at(-11, 0), at(-8, -10), at(1, -13), at(8, -7)]; // 위에서 본 몸통 팔각형
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
  const gunStart = at(3, 8); // 오른손 위치에서
  const gunEnd = at(27, 6); // 앞으로 뻗은 총구까지
  const shoulder = at(-2, 10);
  g.lineStyle(4 * s, color(look.accent), alpha);
  g.lineBetween(shoulder.x, shoulder.y, gunStart.x, gunStart.y);
  g.lineStyle(5 * s, flash ? 0xffffff : 0x2b2f3a, alpha);
  g.lineBetween(gunStart.x, gunStart.y, gunEnd.x, gunEnd.y);
  g.lineStyle(2 * s, color(look.hairHighlight), alpha);
  const tip = at(22, 6); // 총구 끝을 다른 색으로 칠해 방향이 잘 보이게
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
  const face = at(4.5, 0); // 얼굴은 정수리보다 약간 앞 (위에서 내려다본 시점)
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
    // 턱 아래 크라바트 (흰 삼각형)
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
  const hl = at(-1, -3); // 머리 광택 점
  g.fillCircle(hl.x, hl.y, 3 * s);

  if (look.gem) {
    const gem = at(8, 0);
    g.fillStyle(0x4cc9f0, alpha * 0.35); // 보석의 은은한 빛 (반투명 원) 위에 마름모 보석
    g.fillCircle(gem.x, gem.y, 4.5 * s);
    g.fillStyle(flash ? 0xffffff : 0x7fe3ff, alpha);
    g.fillPoints([at(11, 0), at(8, 2.2), at(5.5, 0), at(8, -2.2)], true);
  }
}
