import Phaser from 'phaser';
import { CHARACTERS, CHARACTER_ORDER, DEFAULT_CHARACTER, characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import type { GameMode } from '../../sim/types';
import { LOOKS, drawFatima } from '../fx/Fatima';
import { addPortraitCard } from '../fx/Portraits';
import { sfx } from '../audio/Sfx';
import { LOADOUTS, WEAPONS } from '../../sim/weapons';
import { selectedLoadout, setLoadout } from '../loadout';
import { selectedDifficulty, setDifficulty } from '../difficulty';
import { DIFFICULTY_LABEL, DIFFICULTY_ORDER } from '../../sim/difficulty';
import { clearPendingJoin, pendingJoinCode } from '../../net/pairing';
import { canInstall, isStandalone, onInstallAvailabilityChange, promptInstall } from '../../pwa';
import { FONT, fontPx, makeButton, makeLabel, padButton, px, uiScale } from '../ui';

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
  private weaponButtons: Phaser.GameObjects.Text[] = [];
  private weaponHint!: Phaser.GameObjects.Text;
  private muteButton!: Phaser.GameObjects.Text;
  private installButton!: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const u = (n: number) => px(this, n);
    // 창 크기나 화면 방향이 바뀌면 배율부터 다시 잡아야 하므로 장면을 다시 그린다
    this.watchResize();

    makeLabel(this, cx, height * 0.08, 'ARENA SHOOTER', 36);
    makeLabel(this, cx, height * 0.08 + u(32), '파티마와 함께, 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임)', 14);

    // 왼쪽: 원작 일러스트 카드 + 인게임 모습 / 오른쪽: 선택과 메뉴
    this.cardW = Math.min(width * 0.36, height * 0.62);
    this.cardH = height * 0.74;
    this.cardX = width * 0.26;
    this.cardY = height * 0.6;
    this.previewX = this.cardX + this.cardW / 2 - u(30);
    this.previewY = this.cardY + this.cardH / 2 - u(30);
    this.preview = this.add.graphics().setDepth(5);

    const rx = width * 0.68;
    const pickY = height * 0.3;
    this.charName = this.add
      .text(rx, pickY, '', { fontFamily: FONT, fontSize: fontPx(this, 28), color: '#ffffff' })
      .setOrigin(0.5);
    this.charRole = makeLabel(this, rx, pickY + u(28), '', 15);
    makeButton(this, rx - u(150), pickY + u(8), '◀', () => this.cycle(-1), 22);
    makeButton(this, rx + u(150), pickY + u(8), '▶', () => this.cycle(1), 22);
    this.weaponHint = makeLabel(this, rx, pickY + u(84), '', 12).setColor('#8fa3c8');
    this.refreshCharacter();

    this.modeButton = makeButton(this, rx, height * 0.6, '', () => this.toggleMode(), 17);
    this.refreshMode();

    const btnY = height * 0.74;
    const step = u(54);
    const pending = pendingJoinCode();
    if (pending) {
      // QR/링크로 들어온 경우: 캐릭터·무기를 고른 뒤 이 방으로 들어간다
      makeLabel(this, rx, btnY - u(34), `초대받은 방 · 코드 ${pending}`, 15).setColor('#ffe066');
      makeButton(this, rx, btnY + u(4), '이 파티마로 참가', () => {
        clearPendingJoin();
        this.go('Lobby', { role: 'guest', code: pending });
      }, 22);
      makeButton(this, rx, btnY + u(4) + step, '취소', () => {
        clearPendingJoin();
        sfx.ui();
        this.scene.restart();
      }, 16);
    } else {
      // 윗줄: 혼자 하기와 그 난이도 / 아랫줄: 둘이 하기
      const solo = makeButton(this, rx, btnY, '혼자 하기', () => this.go('Arena', { mode: 'solo' }), 20);
      this.buildDifficulty(solo, rx, btnY);
      makeButton(this, rx - u(90), btnY + step, '방 만들기', () => this.go('Lobby', { role: 'host' }), 20);
      makeButton(this, rx + u(90), btnY + step, '참가하기', () => this.go('Lobby', { role: 'guest' }), 20);
    }

    // 조작 안내는 일러스트 카드와 겹치지 않도록 카드 오른쪽 영역의 맨 아래에 둔다.
    // 두 줄을 다 넣으면 폰에서 버튼과 부딪히므로 지금 기기에 맞는 한 줄만 보여준다.
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const cardRight = this.cardX + this.cardW / 2;
    const freeW = width - cardRight;
    // 글자는 화면 높이에 맞춰 키우되, 한 줄에 안 들어가면 들어갈 때까지 줄인다(두 줄이 되면 버튼과 겹친다).
    const hint = makeLabel(
      this,
      cardRight + freeW / 2,
      height - u(16),
      touch
        ? '왼쪽 드래그 이동 · 오른쪽 드래그 조준·발사 · 무기 버튼 교체'
        : 'WASD 이동 · 마우스 조준 · 클릭 발사 · Shift 대시 · 1~3 무기',
      13,
    ).setColor('#a9b6d6');
    let size = Number.parseInt(String(hint.style.fontSize), 10);
    while (hint.width > freeW - u(16) && size > 10) hint.setFontSize(--size);

    this.muteButton = makeButton(this, width - u(44), u(30), '', () => this.toggleMute(), 18);
    this.refreshMute();

    this.installButton = makeButton(this, width - u(44), u(76), '설치', () => void this.install(), 14).setVisible(false);
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
    const r = px(this, 34);
    g.fillCircle(this.previewX, this.previewY, r);
    g.lineStyle(2, CHARACTERS[id].color, 0.7);
    g.strokeCircle(this.previewX, this.previewY, r);
    drawFatima(g, look, {
      x: this.previewX,
      y: this.previewY,
      aim,
      trailX: -0.9,
      trailY: 0.35 + Math.sin(time / 1300) * 0.15,
      time,
      scale: 1.1 * uiScale(this),
      alpha: 1,
      flash: false,
    });
  }

  // 창 크기가 바뀌면 배율과 배치를 처음부터 다시 잡는다. 고른 값은 registry에 있으므로 잃지 않는다.
  private watchResize(): void {
    let timer: Phaser.Time.TimerEvent | null = null;
    const onResize = (): void => {
      timer?.remove();
      timer = this.time.delayedCall(150, () => this.scene.restart());
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
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

  // 혼자 하기 버튼 오른쪽에 하·중·상 세 칸을 붙이고, 둘을 한 덩어리로 가운데 맞춘다.
  // 대전에서는 봇의 솜씨, 방어전에서는 적의 수가 바뀐다 (sim/difficulty.ts).
  private buildDifficulty(solo: Phaser.GameObjects.Text, rx: number, y: number): void {
    const gap = px(this, 10);
    const segGap = px(this, 4);
    const segs = DIFFICULTY_ORDER.map((d) =>
      makeButton(this, 0, y, DIFFICULTY_LABEL[d], () => {
        setDifficulty(this, d);
        sfx.ui();
        paint();
      }, 17),
    );
    for (const seg of segs) padButton(seg, 12, 12);
    const segW = segs.reduce((a, s) => a + s.displayWidth, 0) + segGap * (segs.length - 1);
    const total = solo.displayWidth + gap + segW;
    let x = rx - total / 2;
    solo.setX(x + solo.displayWidth / 2);
    x += solo.displayWidth + gap;
    for (const s of segs) {
      s.setX(x + s.displayWidth / 2);
      x += s.displayWidth + segGap;
    }
    const paint = (): void => {
      const current = selectedDifficulty(this);
      segs.forEach((s, i) => {
        const on = DIFFICULTY_ORDER[i] === current;
        s.setBackgroundColor(on ? '#4cc9f0' : '#1f2a44').setColor(on ? '#0b0f1a' : '#ffffff');
      });
    };
    paint();
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
    this.rebuildWeapons();
  }

  // 파티마별 기본 무기 선택 줄. 고른 것은 강조하고 설명을 아래에 보여준다.
  private rebuildWeapons(): void {
    for (const b of this.weaponButtons) b.destroy();
    this.weaponButtons = [];
    const id = selectedCharacter(this);
    const options = LOADOUTS[id];
    const current = selectedLoadout(this, id);
    const rx = this.scale.width * 0.68;
    const y = this.scale.height * 0.3 + px(this, 58);
    options.forEach((w, i) => {
      const x = rx + (i - (options.length - 1) / 2) * px(this, 126);
      const btn = makeButton(this, x, y, WEAPONS[w].name, () => {
        setLoadout(this, id, w);
        sfx.ui();
        this.rebuildWeapons();
      }, 14);
      padButton(btn, 10, 7);
      if (w === current) btn.setBackgroundColor('#4cc9f0').setColor('#0b0f1a');
      this.weaponButtons.push(btn);
    });
    this.weaponHint.setText(`${WEAPONS[current].name}: ${WEAPONS[current].description}`);
  }
}
