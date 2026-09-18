import Phaser from 'phaser';
import { CHARACTERS, CHARACTER_ORDER, DEFAULT_CHARACTER, characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import type { GameMode } from '../../sim/types';
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
  private charDot!: Phaser.GameObjects.Arc;
  private modeButton!: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    makeLabel(this, cx, height * 0.14, 'ARENA SHOOTER', 44);
    makeLabel(this, cx, height * 0.14 + 40, '파티마와 함께, 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임)', 16);

    const pickY = height * 0.38;
    this.charDot = this.add.circle(cx, pickY - 34, 16, 0xffffff);
    this.charName = this.add
      .text(cx, pickY, '', { fontFamily: FONT, fontSize: '30px', color: '#ffffff' })
      .setOrigin(0.5);
    this.charRole = makeLabel(this, cx, pickY + 30, '', 16);
    makeButton(this, cx - 150, pickY, '◀', () => this.cycle(-1)).setFontSize(22);
    makeButton(this, cx + 150, pickY, '▶', () => this.cycle(1)).setFontSize(22);
    this.refreshCharacter();

    this.modeButton = makeButton(this, cx, height * 0.56, '', () => this.toggleMode()).setFontSize(20);
    this.refreshMode();

    const btnY = height * 0.7;
    makeButton(this, cx, btnY, '혼자 하기', () => this.scene.start('Arena', { mode: 'solo' }));
    makeButton(this, cx, btnY + 60, '방 만들기', () => this.scene.start('Lobby', { role: 'host' }));
    makeButton(this, cx, btnY + 120, '참가하기', () => this.scene.start('Lobby', { role: 'guest' }));
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
    this.charDot.setFillStyle(c.color);
    this.charName.setText(c.name);
    this.charRole.setText(`${c.role}  ·  ${characterIndex(c.id) + 1}/${CHARACTER_ORDER.length}`);
  }
}
