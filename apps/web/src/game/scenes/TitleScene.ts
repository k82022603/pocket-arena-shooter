import Phaser from 'phaser';
import { CHARACTERS, CHARACTER_ORDER, DEFAULT_CHARACTER, characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import type { GameMode } from '../../sim/types';
import { LOOKS, drawFatima } from '../fx/Fatima';
import { addPortraitCard } from '../fx/Portraits';
import { sfx } from '../audio/Sfx';
import { canInstall, isStandalone, onInstallAvailabilityChange, promptInstall } from '../../pwa';
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
  private card: Phaser.GameObjects.Container | null = null;
  private cardX = 0;
  private cardY = 0;
  private cardW = 0;
  private cardH = 0;
  private previewX = 0;
  private previewY = 0;
  private modeButton!: Phaser.GameObjects.Text;
  private muteButton!: Phaser.GameObjects.Text;
  private installButton!: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    makeLabel(this, cx, height * 0.08, 'ARENA SHOOTER', 36);
    makeLabel(this, cx, height * 0.08 + 32, '파티마와 함께, 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임)', 14);

    // 왼쪽: 원작 일러스트 카드 + 인게임 모습 / 오른쪽: 선택과 메뉴
    this.cardW = Math.min(width * 0.36, height * 0.62);
    this.cardH = height * 0.74;
    this.cardX = width * 0.26;
    this.cardY = height * 0.6;
    this.previewX = this.cardX + this.cardW / 2 - 30;
    this.previewY = this.cardY + this.cardH / 2 - 30;
    this.preview = this.add.graphics().setDepth(5);

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
    makeButton(this, rx, btnY, '혼자 하기', () => this.go('Arena', { mode: 'solo' })).setFontSize(24);
    makeButton(this, rx, btnY + step, '방 만들기', () => this.go('Lobby', { role: 'host' })).setFontSize(24);
    makeButton(this, rx, btnY + step * 2, '참가하기', () => this.go('Lobby', { role: 'guest' })).setFontSize(24);

    makeLabel(this, rx, height * 0.97, '터치: 왼쪽 드래그 이동 · 오른쪽 드래그 조준/발사   |   PC: WASD 이동 · 마우스 조준 · 클릭 발사 · Shift 대시', 11).setColor('#6f7fa3');

    this.muteButton = makeButton(this, width - 44, 30, '', () => this.toggleMute()).setFontSize(18);
    this.refreshMute();

    this.installButton = makeButton(this, width - 44, 76, '설치', () => void this.install())
      .setFontSize(14)
      .setVisible(false);
    this.refreshInstall();
    const off = onInstallAvailabilityChange(() => this.refreshInstall());
    this.events.once('shutdown', off);
  }

  update(time: number): void {
    const id = selectedCharacter(this);
    const look = LOOKS[id];
    const aim = -0.35 + Math.sin(time / 900) * 0.25;
    const g = this.preview;
    g.clear();
    g.fillStyle(0x0b0f1a, 0.85);
    g.fillCircle(this.previewX, this.previewY, 34);
    g.lineStyle(2, CHARACTERS[id].color, 0.7);
    g.strokeCircle(this.previewX, this.previewY, 34);
    drawFatima(g, look, {
      x: this.previewX,
      y: this.previewY,
      aim,
      trailX: -0.9,
      trailY: 0.35 + Math.sin(time / 1300) * 0.15,
      time,
      scale: 1.1,
      alpha: 1,
      flash: false,
    });
  }

  private go(scene: string, data: object): void {
    sfx.ui();
    this.scene.start(scene, data);
  }

  private toggleMute(): void {
    sfx.setMuted(!sfx.muted);
    this.refreshMute();
    sfx.ui();
  }

  private refreshMute(): void {
    this.muteButton.setText(sfx.muted ? '🔇' : '🔊');
  }

  private refreshInstall(): void {
    this.installButton.setVisible(canInstall() && !isStandalone());
  }

  private async install(): Promise<void> {
    sfx.ui();
    await promptInstall();
    this.refreshInstall();
  }

  private cycle(delta: number): void {
    const next = characterAt(characterIndex(selectedCharacter(this)) + delta);
    this.registry.set(REGISTRY_CHARACTER, next);
    this.refreshCharacter();
    sfx.ui();
  }

  private toggleMode(): void {
    this.registry.set(REGISTRY_MODE, selectedMode(this) === 'duel' ? 'coop' : 'duel');
    this.refreshMode();
    sfx.ui();
  }

  private refreshMode(): void {
    this.modeButton.setText(`모드: ${MODE_LABEL[selectedMode(this)]}  ⇄`);
  }

  private refreshCharacter(): void {
    const c = CHARACTERS[selectedCharacter(this)];
    this.charName.setText(c.name);
    this.charRole.setText(`${c.role}  ·  ${characterIndex(c.id) + 1}/${CHARACTER_ORDER.length}`);
    this.card?.destroy();
    this.card = addPortraitCard(this, c.id, this.cardX, this.cardY, this.cardW, this.cardH, c.color);
  }
}
