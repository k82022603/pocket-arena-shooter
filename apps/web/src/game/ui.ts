import Phaser from 'phaser';

export const FONT = 'system-ui, -apple-system, "Noto Sans KR", sans-serif';

// 화면 크기에 맞춘 UI 배율. 폰 가로(844×390)에서 보기 좋게 잡은 크기를 기준 1로 두고,
// 큰 화면에서는 그만큼 키우고 작은 폰에서는 조금 줄인다. 글자·버튼·간격은 모두 이 값을 곱해 쓴다.
// 캔버스는 이미 화면을 가득 채우므로(Phaser RESIZE), 배율만 맞추면 어느 화면에서든 같은 모양이 된다.
const DESIGN_W = 844;
const DESIGN_H = 390;
const MIN_SCALE = 0.85;
const MAX_SCALE = 2;

export function uiScale(scene: Phaser.Scene): number {
  const { width, height } = scene.scale;
  return Phaser.Math.Clamp(Math.min(width / DESIGN_W, height / DESIGN_H), MIN_SCALE, MAX_SCALE);
}

/** 기준 크기(px)를 지금 화면의 크기로 바꾼다 */
export function px(scene: Phaser.Scene, n: number): number {
  return Math.round(n * uiScale(scene));
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
  size = 28,
): Phaser.GameObjects.Text {
  const s = uiScale(scene);
  const text = scene.add
    .text(x, y, label, {
      fontFamily: FONT,
      fontSize: `${Math.round(size * s)}px`,
      color: '#ffffff',
      backgroundColor: '#1f2a44',
      padding: { x: Math.round(28 * s), y: Math.round(14 * s) },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  text.on('pointerdown', () => text.setAlpha(0.7));
  text.on('pointerup', () => {
    text.setAlpha(1);
    onTap();
  });
  text.on('pointerout', () => text.setAlpha(1));
  return text;
}

/** 버튼 안쪽 여백을 기준 크기로 바꾼다 */
export function padButton(button: Phaser.GameObjects.Text, x: number, y: number): Phaser.GameObjects.Text {
  const s = uiScale(button.scene);
  return button.setPadding(Math.round(x * s), Math.round(y * s), Math.round(x * s), Math.round(y * s));
}

export function makeLabel(scene: Phaser.Scene, x: number, y: number, label: string, size = 22): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, label, { fontFamily: FONT, fontSize: `${px(scene, size)}px`, color: '#c9d1e3', align: 'center' })
    .setOrigin(0.5);
}

/** 기준 크기의 글자 스타일 (makeLabel을 쓰지 않는 텍스트용) */
export function fontPx(scene: Phaser.Scene, size: number): string {
  return `${px(scene, size)}px`;
}
