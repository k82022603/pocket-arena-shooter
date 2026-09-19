import Phaser from 'phaser';
import type { CharacterId } from '../../sim/characters';

// 사용자가 제공한 원작 일러스트. 한 장에 여러 인물이 있는 그림은 비율 좌표로 잘라 쓰고,
// 종이 배경은 flood-fill로 지우고 옆 인물이 끼어드는 부분은 제외 영역으로 비운다.
interface PortraitSpec {
  texture: string;
  // [x0, y0, x1, y1] — 원본 이미지에 대한 비율
  rect: [number, number, number, number];
  // 잘라낸 영역 안에서 투명하게 비울 사각형들 (잘라낸 영역에 대한 비율)
  exclude?: [number, number, number, number][];
}

// 단독 전신 일러스트(흰 배경). 예비: fates-trio.webp(세 자매 그룹), est-black-knight.png, atropos2.jpg(핑크 제복), est1/6(오렌지 드레스)
const TEXTURES: Record<string, string> = {
  'fatima-lachesis': `${import.meta.env.BASE_URL}fatima/laki2.jpg`,
  'fatima-clotho': `${import.meta.env.BASE_URL}fatima/clotho1.jpg`,
  'fatima-atropos': `${import.meta.env.BASE_URL}fatima/atropos1.jpg`,
  'fatima-est': `${import.meta.env.BASE_URL}fatima/est2.jpg`,
};

const SPECS: Record<CharacterId, PortraitSpec> = {
  lachesis: { texture: 'fatima-lachesis', rect: [0, 0, 1, 1] },
  clotho: { texture: 'fatima-clotho', rect: [0, 0, 1, 1] },
  atropos: { texture: 'fatima-atropos', rect: [0, 0, 1, 1] },
  est: { texture: 'fatima-est', rect: [0, 0, 1, 1] },
};

// 배경으로 볼 색 거리 (RGB 유클리드). 종이 크림색·흰 배경은 지우고 흰 소매는 검은 윤곽선에 막혀 남는다.
const BACKGROUND_TOLERANCE = 42;

export function preloadPortraits(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, url] of Object.entries(TEXTURES)) loader.image(key, url);
}

function cutout(scene: Phaser.Scene, id: CharacterId): string | null {
  const key = `cutout-${id}`;
  if (scene.textures.exists(key)) return key;
  const spec = SPECS[id];
  if (!scene.textures.exists(spec.texture)) return null;
  const src = scene.textures.get(spec.texture).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const [x0, y0, x1, y1] = spec.rect;
  const sx = Math.round(src.width * x0);
  const sy = Math.round(src.height * y0);
  const w = Math.max(1, Math.round(src.width * (x1 - x0)));
  const h = Math.max(1, Math.round(src.height * (y1 - y0)));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  for (const [ex0, ey0, ex1, ey1] of spec.exclude ?? []) {
    for (let y = Math.floor(h * ey0); y < Math.ceil(h * ey1); y++) {
      for (let x = Math.floor(w * ex0); x < Math.ceil(w * ex1); x++) d[(y * w + x) * 4 + 3] = 0;
    }
  }

  // 테두리 픽셀의 채널별 중앙값을 배경색으로 잡는다 (모서리에 옆 인물이 걸려도 흔들리지 않게).
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y++) border.push(y * w * 4, (y * w + w - 1) * 4);
  const bg = [0, 1, 2].map((c) => {
    const values = border.map((i) => d[i + c]!).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  });
  const isBackground = (i: number) => {
    if (d[i + 3] === 0) return true;
    const dr = d[i]! - bg[0]!;
    const dg = d[i + 1]! - bg[1]!;
    const db = d[i + 2]! - bg[2]!;
    return Math.sqrt(dr * dr + dg * dg + db * db) < BACKGROUND_TOLERANCE;
  };
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    if (!isBackground(p * 4)) continue;
    d[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // 지워진 픽셀과 맞닿은 가장자리는 반투명으로 부드럽게
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const nb = [i - 4, i + 4, i - w * 4, i + w * 4];
      if (nb.some((n) => d[n + 3] === 0)) d[i + 3] = 150;
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}

// 오려낸 일러스트를 어두운 카드 안에 비율을 지켜 넣는다. 이미지가 없으면 null.
export function addPortraitCard(
  scene: Phaser.Scene,
  id: CharacterId,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: number,
  padding = 6,
): Phaser.GameObjects.Container | null {
  const key = cutout(scene, id);
  if (!key) return null;
  const radius = Math.min(12, width * 0.08);
  const g = scene.add.graphics();
  g.fillStyle(0x121a2c, 1);
  g.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
  g.fillStyle(accent, 0.08);
  g.fillCircle(0, height * 0.1, Math.min(width, height) * 0.42);
  g.lineStyle(2, accent, 0.8);
  g.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
  const img = scene.add.image(0, 0, key);
  const scale = Math.min((width - padding * 2) / img.width, (height - padding * 2) / img.height);
  img.setScale(scale);
  return scene.add.container(x, y, [g, img]);
}
