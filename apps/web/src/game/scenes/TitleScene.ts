import Phaser from 'phaser';
import { CHARACTERS, CHARACTER_ORDER, DEFAULT_CHARACTER, characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import type { GameMode } from '../../sim/types';
import { LOOKS, drawFatima } from '../fx/Fatima';
import { addPortraitCard } from '../fx/Portraits';
import { sfx } from '../audio/Sfx';
import { LOADOUTS, WEAPONS } from '../../sim/weapons';
import { selectedLoadout, setLoadout } from '../loadout';
import { selectedDifficulty, setDifficulty } from '../difficulty';
import { aimAssistOn, setAimAssist } from '../aimSetting';
import { DIFFICULTY_LABEL, DIFFICULTY_ORDER } from '../../sim/difficulty';
import { clearPendingJoin, pendingJoinCode } from '../../net/pairing';
import { canInstall, isStandalone, onInstallAvailabilityChange, promptInstall } from '../../pwa';
import { FONT, TYPE, accentOf, applySkinBackground, cycleSkin, fontPx, makeButton, makeLabel, px, sizeButton, skin, styleButton, uiScale } from '../ui';

// 타이틀: 파티마·무기·모드·난이도를 고르고 혼자 하기 / 방 만들기 / 참가하기로 나간다.
// 고른 값은 Phaser registry(장면 사이 공유 저장소)에 둔다. 다른 장면이 여기 함수로 읽는다.

export const REGISTRY_CHARACTER = 'character';
export const REGISTRY_MODE = 'mode';

export function selectedCharacter(scene: Phaser.Scene): CharacterId {
  return (scene.registry.get(REGISTRY_CHARACTER) as CharacterId | undefined) ?? DEFAULT_CHARACTER;
}

export function selectedMode(scene: Phaser.Scene): GameMode {
  return (scene.registry.get(REGISTRY_MODE) as GameMode | undefined) ?? 'duel'; // 처음엔 1:1 대전
}

export const MODE_LABEL: Record<GameMode, string> = {
  duel: '1:1 대전',
  coop: '협동 방어전',
};

export class TitleScene extends Phaser.Scene {
  private charName!: Phaser.GameObjects.Text;
  private charRole!: Phaser.GameObjects.Text;
  private preview!: Phaser.GameObjects.Graphics; // 카드 오른쪽 아래의 게임 속 모습 미리보기
  private card: Phaser.GameObjects.Container | null = null; // 원작 일러스트 카드 (파티마를 바꾸면 새로 만든다)
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
  private colX = 0; // 오른쪽 메뉴 열의 가운데 x
  // 강조색을 쓰는 버튼. 파티마를 바꾸면 강조색도 바뀌므로 다시 칠한다
  private actionButtons: Phaser.GameObjects.Text[] = [];
  private paintDifficulty: () => void = () => {}; // 난이도 칸을 다시 칠하는 함수 (buildSoloRow가 채운다)
  private weaponY = 0; // 무기 줄의 y
  private installButton!: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  // 오른쪽 메뉴 열의 기준 폭과 줄 배치(기준 크기). 모든 버튼이 이 폭의 격자에 맞춰 선다.
  private static readonly COL = 330;

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const k = uiScale(this); // 화면 크기 배율
    const u = (n: number) => px(this, n); // 기준 크기 → 지금 화면의 px
    // 창 크기나 화면 방향이 바뀌면 배율부터 다시 잡아야 하므로 장면을 다시 그린다
    this.watchResize();
    applySkinBackground(this);
    this.actionButtons = [];
    const k0 = skin(); // 지금 스킨의 색

    makeLabel(this, cx, u(34), 'ARENA SHOOTER', TYPE.display).setColor(k0.text).setLetterSpacing(u(3));
    makeLabel(this, cx, u(64), '파티마와 함께, 옆 사람과 바로 붙는 2인 슈팅 (FSS 팬 게임)', TYPE.caption).setColor(k0.textDim);

    // 왼쪽 일러스트 카드와 오른쪽 메뉴 열을 한 덩어리로 보고 화면 가운데에 놓는다.
    // 화면이 넓어도 둘이 양끝으로 벌어지지 않는다.
    const top = u(84); // 제목 아래부터
    const bottom = height - u(26); // 조작 안내 위까지
    const col = TitleScene.COL * k;
    this.cardH = bottom - top + u(12);
    this.cardW = Math.min(width * 0.36, this.cardH * 0.78); // 세로로 긴 전신 일러스트 비율, 화면 폭의 36%를 넘지 않게
    const gap = u(40);
    const left = (width - (this.cardW + gap + col)) / 2; // 카드+간격+메뉴 열 전체를 가운데로
    this.cardX = left + this.cardW / 2;
    this.cardY = top + this.cardH / 2;
    this.previewX = this.cardX + this.cardW / 2 - u(30);
    this.previewY = this.cardY + this.cardH / 2 - u(30);
    this.preview = this.add.graphics().setDepth(5);

    const rx = left + this.cardW + gap + col / 2;
    this.colX = rx;
    // 메뉴 열의 높이는 264(기준). 남는 세로 공간의 가운데에 둔다.
    const y0 = top + Math.max(0, (bottom - top - u(264)) / 2);
    const at = (n: number) => y0 + u(n); // 메뉴 열 안의 세로 위치 (기준 크기)

    this.charName = this.add
      .text(rx, at(14), '', { fontFamily: FONT, fontSize: fontPx(this, TYPE.heading), color: k0.text })
      .setOrigin(0.5);
    this.charRole = makeLabel(this, rx, at(40), '', TYPE.caption).setColor(k0.textDim);
    const arrowX = col / 2 - u(20); // 화살표 버튼(폭 40)이 메뉴 열의 양끝에 딱 붙는 위치
    sizeButton(makeButton(this, rx - arrowX, at(24), '◀', () => this.cycle(-1), TYPE.button, 'ghost'), 40, 40);
    sizeButton(makeButton(this, rx + arrowX, at(24), '▶', () => this.cycle(1), TYPE.button, 'ghost'), 40, 40);
    this.weaponY = at(71);
    this.weaponHint = makeLabel(this, rx, at(100), '', TYPE.caption).setColor(k0.textDim);

    const pending = pendingJoinCode();
    if (pending) {
      // QR/링크로 들어온 경우: 캐릭터·무기를 고른 뒤 이 방으로 들어간다. 모드는 방을 만든 쪽이 정한다.
      makeLabel(this, rx, at(137), `초대받은 방 · 코드 ${pending}`, TYPE.body).setColor('#ffe066');
      const join = makeButton(this, rx, at(193), '이 파티마로 참가', () => {
        clearPendingJoin();
        this.go('Lobby', { role: 'guest', code: pending });
      }, TYPE.button);
      sizeButton(join, TitleScene.COL, 42);
      styleButton(join, 'action');
      this.actionButtons.push(join);
      const cancel = makeButton(this, rx, at(243), '취소', () => {
        clearPendingJoin();
        sfx.ui();
        this.scene.restart();
      }, TYPE.body, 'ghost');
      sizeButton(cancel, 160, 42);
    } else {
      this.modeButton = makeButton(this, rx, at(137), '', () => this.toggleMode(), TYPE.body);
      sizeButton(this.modeButton, TitleScene.COL, 38);
      this.refreshMode();

      // 윗줄: 혼자 하기와 그 난이도 / 아랫줄: 둘이 하기. 두 줄의 양끝이 맞는다.
      this.buildSoloRow(rx, at(193));
      const half = (TitleScene.COL - 10) / 2; // 두 버튼 + 간격 10이 메뉴 열 폭과 같게
      const hx = u(half / 2 + 5);
      const host = makeButton(this, rx - hx, at(243), '방 만들기', () => this.go('Lobby', { role: 'host' }), TYPE.button, 'action');
      const join = makeButton(this, rx + hx, at(243), '참가하기', () => this.go('Lobby', { role: 'guest' }), TYPE.button, 'action');
      this.actionButtons.push(sizeButton(host, half, 42), sizeButton(join, half, 42));
    }
    this.refreshCharacter();

    // 조작 안내: 메뉴 열 아래, 지금 기기에 맞는 한 줄만. 한 줄에 안 들어가면 들어갈 때까지 줄인다.
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false; // 손가락처럼 굵은 포인터면 터치 기기
    const cardRight = this.cardX + this.cardW / 2;
    const room = Math.min(width - rx, rx - cardRight) * 2 - u(16); // 메뉴 열 가운데를 기준으로 카드와 화면 끝 사이에 들어갈 폭
    const hint = makeLabel(
      this,
      rx,
      height - u(14),
      touch
        ? '왼쪽 드래그 이동 · 오른쪽 드래그 조준·발사 · 무기 버튼 교체'
        : 'WASD 이동 · 마우스 조준 · 클릭 발사 · Shift 대시 · 1~3 무기',
      TYPE.caption,
    ).setColor(k0.textDim);
    let size = Number.parseInt(String(hint.style.fontSize), 10);
    while (hint.width > room && size > 10) hint.setFontSize(--size);

    // 오른쪽 위 설정 줄: [스킨][🔊], 그 아래 [조준 보정][설치]
    this.muteButton = sizeButton(makeButton(this, width - u(28), u(28), '', () => this.toggleMute(), TYPE.body, 'ghost'), 36, 36);
    // 스킨: 누를 때마다 다음 스킨으로. 색은 장면 전체에 걸리므로 다시 그린다
    sizeButton(
      makeButton(this, width - u(28 + 18 + 8 + 48), u(28), `스킨 · ${k0.name}`, () => {
        cycleSkin();
        sfx.ui();
        this.scene.restart();
      }, TYPE.caption, 'ghost'),
      96,
      36,
    );
    // 조준 보정: 협동과 봇 상대 대전에서 조준 방향 앞 18도 안의 적에게 붙여 쏜다. 켜져 있으면 강조색 테두리
    // 제목과 겹치지 않게 스킨 버튼 바로 아래 줄에 둔다
    const assist = makeButton(this, width - u(28 + 18 + 8 + 48), u(70), '', () => {
      setAimAssist(this, !aimAssistOn(this));
      sfx.ui();
      paintAssist();
    }, TYPE.caption, 'ghost');
    const paintAssist = (): void => {
      const on = aimAssistOn(this);
      assist.setText(on ? '조준 보정 켬' : '조준 보정 끔');
      sizeButton(assist, 100, 36);
      styleButton(assist, on ? 'chipOn' : 'ghost', this.accent());
    };
    paintAssist();
    this.refreshMute();

    this.installButton = sizeButton(makeButton(this, width - u(28), u(70), '설치', () => void this.install(), TYPE.caption, 'ghost'), 36, 28).setVisible(
      false,
    );
    this.refreshInstall();
    const off = onInstallAvailabilityChange(() => this.refreshInstall());
    this.events.once('shutdown', off); // 장면을 떠나면 구독을 푼다
  }

  update(time: number): void {
    const id = selectedCharacter(this);
    const look = LOOKS[id];
    const aim = -0.35 + Math.sin(time / 900) * 0.25; // 미리보기 캐릭터가 천천히 좌우로 조준을 흔든다
    const g = this.preview;
    g.clear();
    g.fillStyle(0x0b0f1a, 0.85); // 어두운 원 받침 위에 게임 속 모습을 그린다
    const r = px(this, 34);
    g.fillCircle(this.previewX, this.previewY, r);
    g.lineStyle(2, CHARACTERS[id].color, 0.7);
    g.strokeCircle(this.previewX, this.previewY, r);
    drawFatima(g, look, {
      x: this.previewX,
      y: this.previewY,
      aim,
      trailX: -0.9, // 머리카락이 왼쪽 아래로 흘러내리게
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
      // 창을 끄는 동안 수십 번 불리므로, 멈추고 150ms 뒤에 한 번만 다시 그린다
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
    this.installButton.setVisible(canInstall() && !isStandalone()); // 설치할 수 있고 아직 설치 앱으로 열지 않았을 때만
  }

  private async install(): Promise<void> {
    sfx.ui();
    await promptInstall();
    this.refreshInstall();
  }

  private cycle(delta: number): void {
    const next = characterAt(characterIndex(selectedCharacter(this)) + delta); // 끝에서 넘기면 처음으로 돈다
    this.registry.set(REGISTRY_CHARACTER, next);
    this.refreshCharacter();
    sfx.ui();
  }

  // 혼자 하기 버튼 오른쪽에 하·중·상 세 칸. 줄 전체가 메뉴 열 폭(COL)과 같아서 아랫줄과 양끝이 맞는다.
  // 대전에서는 봇의 솜씨, 방어전에서는 적의 수가 바뀐다 (sim/difficulty.ts).
  private buildSoloRow(rx: number, y: number): void {
    const segW = 46; // 난이도 칸 하나의 폭
    const segGap = 4; // 칸 사이
    const gap = 10; // 혼자 하기와 첫 칸 사이
    const soloW = TitleScene.COL - gap - segW * DIFFICULTY_ORDER.length - segGap * (DIFFICULTY_ORDER.length - 1); // 남는 폭이 혼자 하기 버튼
    const u = (n: number) => px(this, n);
    const left = rx - u(TitleScene.COL / 2); // 메뉴 열의 왼쪽 끝
    const solo = makeButton(this, left + u(soloW / 2), y, '혼자 하기', () => this.go('Arena', { mode: 'solo' }), TYPE.button, 'action');
    this.actionButtons.push(sizeButton(solo, soloW, 42));
    const segs = DIFFICULTY_ORDER.map((d, i) => {
      const x = left + u(soloW + gap + i * (segW + segGap) + segW / 2);
      const seg = makeButton(this, x, y, DIFFICULTY_LABEL[d], () => {
        setDifficulty(this, d);
        sfx.ui();
        paint();
      }, TYPE.button, 'chip');
      return sizeButton(seg, segW, 42);
    });
    const paint = (): void => {
      const current = selectedDifficulty(this);
      const accent = this.accent();
      segs.forEach((seg, i) => styleButton(seg, DIFFICULTY_ORDER[i] === current ? 'chipOn' : 'chip', accent));
    };
    this.paintDifficulty = paint;
    paint();
  }
  /** 지금 화면의 강조색: 스킨이 정하지 않으면 고른 파티마의 색 */
  private accent(): number {
    return accentOf(CHARACTERS[selectedCharacter(this)].color);
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
    this.charRole.setText(`${c.role}  ·  ${characterIndex(c.id) + 1}/${CHARACTER_ORDER.length}`); // 예: 올라운더 · 1/4
    this.card?.destroy();
    this.card = addPortraitCard(this, c.id, this.cardX, this.cardY, this.cardW, this.cardH, c.color);
    // 기본 스킨이면 강조색이 파티마를 따라 바뀌므로 버튼들을 다시 칠한다
    const accent = this.accent();
    for (const b of this.actionButtons) styleButton(b, 'action', accent);
    this.paintDifficulty();
    this.rebuildWeapons();
  }

  // 파티마별 기본 무기 선택 줄. 고른 것은 강조하고 설명을 아래에 보여준다.
  private rebuildWeapons(): void {
    for (const b of this.weaponButtons) b.destroy(); // 파티마마다 선택지가 달라 매번 새로 만든다
    this.weaponButtons = [];
    const id = selectedCharacter(this);
    const options = LOADOUTS[id];
    const current = selectedLoadout(this, id);
    // 메뉴 열 폭을 무기 수로 똑같이 나눈다
    const gap = 8;
    const bw = (TitleScene.COL - gap * (options.length - 1)) / options.length;
    options.forEach((w, i) => {
      const x = this.colX + px(this, (i - (options.length - 1) / 2) * (bw + gap)); // 가운데 무기를 열 중심에 두고 좌우로 펼친다
      const btn = makeButton(this, x, this.weaponY, WEAPONS[w].name, () => {
        setLoadout(this, id, w);
        sfx.ui();
        this.rebuildWeapons();
      }, TYPE.body, 'chip');
      sizeButton(btn, bw, 30);
      styleButton(btn, w === current ? 'chipOn' : 'chip', this.accent());
      this.weaponButtons.push(btn);
    });
    this.weaponHint.setText(`${WEAPONS[current].name}: ${WEAPONS[current].description}`);
  }
}
