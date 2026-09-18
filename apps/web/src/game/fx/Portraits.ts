import Phaser from 'phaser';
import type { CharacterId } from '../../sim/characters';

// 사용자가 제공한 원작 일러스트. 한 장에 여러 인물이 있는 그림은 비율 좌표로 잘라 프레임을 만든다.
interface PortraitSpec {
  texture: string;
  // [x0, y0, x1, y1] — 원본 이미지에 대한 비율
  rect: [number, number, number, number];
}

const TEXTURES: Record<string, string> = {
  'fatima-trio': '/fatima/fates-trio.webp',
  'fatima-est': '/fatima/est-black-knight.png',
};

const SPECS: Record<CharacterId, PortraitSpec> = {
  lachesis: { texture: 'fatima-trio', rect: [0.44, 0.02, 0.84, 0.395] },
  clotho: { texture: 'fatima-trio', rect: [0.19, 0.17, 0.57, 0.7] },
  atropos: { texture: 'fatima-trio', rect: [0.5, 0.4, 0.69, 0.93] },
  est: { texture: 'fatima-est', rect: [0.06, 0, 0.94, 0.93] },
};

export const PAPER = 0xf4f0e7;

export function preloadPortraits(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, url] of Object.entries(TEXTURES)) loader.image(key, url);
}

export function portraitFrame(scene: Phaser.Scene, id: CharacterId): { texture: string; frame: string } | null {
  const spec = SPECS[id];
  if (!scene.textures.exists(spec.texture)) return null;
  const tex = scene.textures.get(spec.texture);
  const frame = `portrait-${id}`;
  if (!tex.has(frame)) {
    const src = tex.getSourceImage() as { width: number; height: number };
    const [x0, y0, x1, y1] = spec.rect;
    tex.add(frame, 0, Math.round(src.width * x0), Math.round(src.height * y0), Math.round(src.width * (x1 - x0)), Math.round(src.height * (y1 - y0)));
  }
  return { texture: spec.texture, frame };
}

// 일러스트를 종이 질감 카드 안에 비율을 지켜 넣는다. 이미지가 없으면 null.
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
  const ref = portraitFrame(scene, id);
  if (!ref) return null;
  const g = scene.add.graphics();
  g.fillStyle(PAPER, 1);
  g.fillRoundedRect(-width / 2, -height / 2, width, height, Math.min(12, width * 0.08));
  g.lineStyle(2, accent, 0.8);
  g.strokeRoundedRect(-width / 2, -height / 2, width, height, Math.min(12, width * 0.08));
  const img = scene.add.image(0, 0, ref.texture, ref.frame);
  const scale = Math.min((width - padding * 2) / img.width, (height - padding * 2) / img.height);
  img.setScale(scale);
  return scene.add.container(x, y, [g, img]);
}
