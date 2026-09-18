import Phaser from 'phaser';
import { CHARACTERS, CHARACTER_ORDER, DEFAULT_CHARACTER, characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import type { GameMode } from '../../sim/types';
import { LOOKS, drawFatima } from '../fx/Fatima';
import { FONT, makeButton, makeLabel } from '../ui';

export const REGISTRY_CHARACTER = 'character';
export const REGISTRY_MODE = 'mode';

export function selectedCharacter(scene: Phaser.Scene): CharacterId {
  return (scene.registry.get(REGISTRY_CHARACTER) as CharacterId | undefined) ?? DEFAULT_CHARACTER;
}

export function selectedMode(scene: Phaser.Scene): GameMode {
  return (scene.registry.get(REGISTRY_MODE) as GameMode | undefined) ?? 'duel';
}

export const MODE_LABEL: Record<GameMode, string> = {
  duel: '1:1 대전',
  coop: '협동 방어전',
};

export class TitleScene extends Phaser.Scene {
  private charName!: Phaser.GameObjects.Text;
  private charRole!: Phaser.GameObjects.Text;
  private preview!: Phaser.GameObjects.Graphics;
  private previewX = 0;
  private previewY = 0;
  private modeButton!: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    makeLabel(this, cx, height * 0.09, 'ARENA SHOOTER', 40);
    makeLabel(this, cx, height * 0.09 + 36, '파티마와 함께, 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임)', 15);

    // 왼쪽: 파티마 미리보기 / 오른쪽: 선택과 메뉴
    this.previewX = width * 0.27;
    this.previewY = height * 0.62;
    this.preview = this.add.graphics();

    const rx = width * 0.68;
    const pickY = height * 0.36;
    this.charName = this.add
      .text(rx, pickY, '', { fontFamily: FONT, fontSize: '30px', color: '#ffffff' })
      .setOrigin(0.5);
    this.charRole = makeLabel(this, rx, pickY + 30, '', 16);
    makeButton(this, rx - 150, pickY + 8, '◀', () => this.cycle(-1)).setFontSize(22);
    makeButton(this, rx + 150, pickY + 8, '▶', () => this.cycle(1)).setFontSize(22);
    this.refreshCharacter();

    this.modeButton = makeButton(this, rx, height * 0.53, '', () => this.toggleMode()).setFontSize(18);
    this.refreshMode();

    const btnY = height * 0.68;
    const step = 56;
    makeButton(this, rx, btnY, '혼자 하기', () => this.scene.start('Arena', { mode: 'solo' })).setFontSize(24);
    makeButton(this, rx, btnY + step, '방 만들기', () => this.scene.start('Lobby', { role: 'host' })).setFontSize(24);
    makeButton(this, rx, btnY + step * 2, '참가하기', () => this.scene.start('Lobby', { role: 'guest' })).setFontSize(24);
  }

  update(time: number): void {
    const id = selectedCharacter(this);
    const look = LOOKS[id];
    const aim = -0.35 + Math.sin(time / 900) * 0.25;
    const g = this.preview;
    g.clear();
    g.fillStyle(CHARACTERS[id].color, 0.1);
    g.fillCircle(this.previewX, this.previewY, 80);
    g.lineStyle(2, CHARACTERS[id].color, 0.35);
    g.strokeCircle(this.previewX, this.previewY, 80 + Math.sin(time / 500) * 3);
    drawFatima(g, look, {
      x: this.previewX,
      y: this.previewY,
      aim,
      trailX: -0.9,
      trailY: 0.35 + Math.sin(time / 1300) * 0.15,
      time,
      scale: 2.4,
      alpha: 1,
      flash: false,
    });
  }

  private cycle(delta: number): void {
    const next = characterAt(characterIndex(selectedCharacter(this)) + delta);
    this.registry.set(REGISTRY_CHARACTER, next);
    this.refreshCharacter();
  }

  private toggleMode(): void {
    this.registry.set(REGISTRY_MODE, selectedMode(this) === 'duel' ? 'coop' : 'duel');
    this.refreshMode();
  }

  private refreshMode(): void {
    this.modeButton.setText(`모드: ${MODE_LABEL[selectedMode(this)]}  ⇄`);
  }

  private refreshCharacter(): void {
    const c = CHARACTERS[selectedCharacter(this)];
    this.charName.setText(c.name);
    this.charRole.setText(`${c.role}  ·  ${characterIndex(c.id) + 1}/${CHARACTER_ORDER.length}`);
  }
}
