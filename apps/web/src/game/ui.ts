import Phaser from 'phaser';

export const FONT = 'system-ui, -apple-system, "Noto Sans KR", sans-serif';

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
): Phaser.GameObjects.Text {
  const text = scene.add
    .text(x, y, label, {
      fontFamily: FONT,
      fontSize: '28px',
      color: '#ffffff',
      backgroundColor: '#1f2a44',
      padding: { x: 28, y: 14 },
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

export function makeLabel(scene: Phaser.Scene, x: number, y: number, label: string, size = 22): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, label, { fontFamily: FONT, fontSize: `${size}px`, color: '#c9d1e3', align: 'center' })
    .setOrigin(0.5);
}
