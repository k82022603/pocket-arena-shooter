import Phaser from 'phaser';
import { CHARACTERS } from '../../sim/characters';
import { COOP, ENEMIES, ENEMY_OWNER, SIM, type BulletState, type InputFrame, type PlayerState } from '../../sim/types';
import { LOADOUTS, PICKUP, PICKUP_COLORS, WEAPONS } from '../../sim/weapons';
import type { Session } from '../../net/connect';
import type { FailReason } from '../../net/session';
import type { Unsubscribe } from '../../net/transport';
import type { Outcome } from '../../sim/core';
import { VirtualStick } from '../input/VirtualStick';
import { DesktopControls } from '../input/DesktopControls';
import { Fx } from '../fx/Fx';
import { LOOKS, drawFatima } from '../fx/Fatima';
import { addPortraitCard } from '../fx/Portraits';
import { sfx } from '../audio/Sfx';
import type { CharacterId } from '../../sim/characters';
import { FONT, TYPE, fontPx, makeButton, px, sizeButton, uiScale } from '../ui';
import type { GameSync, RenderState } from '../sync/GameSync';
import { SoloSync } from '../sync/SoloSync';
import { HostSync } from '../sync/HostSync';
import { GuestSync } from '../sync/GuestSync';
import { selectedCharacter, selectedMode } from './TitleScene';
import { selectedDifficulty } from '../difficulty';
import { assistAim, type AssistTarget } from '../aimAssist';
import { aimAssistOn } from '../aimSetting';
import { selectedLoadout } from '../loadout';
import { MatchRecorder, SAMPLE_INTERVAL_TICKS } from '../recorder';

// 경기 화면: 입력을 모아 60Hz 고정 틱으로 시뮬레이션을 돌리고(동기화 구현에 맡긴다), 결과를 그리고, 연출·HUD를 붙인다.
// 혼자·방을 만든 쪽·참가한 쪽 세 경우를 GameSync 하나로 같은 코드가 처리한다.

// 참가한 쪽이 첫 권위 스냅샷을 이만큼 못 받으면 연결이 살아 있다고 볼 수 없다.
const AUTHORITY_TIMEOUT_MS = 12_000;

type ArenaData = { mode: 'solo' } | { mode: 'versus'; session: Session }; // 혼자 하기 | 둘이 하기

const ENEMY_BULLET_COLOR = 0xff7043; // 포수 탄 (주황)
const PLAYER_BULLET_COLOR = 0xffe066;
const FLASH_MS = 90; // 적·코어가 맞았을 때 번쩍이는 시간
// 플레이어 피격은 더 길게, 깜빡이게 보여 준다. 적에게 닿아 아픈 것이 눈에 들어와야 피한다.
const HURT_FLASH_MS = 240; // 깜빡이는 전체 시간
const HURT_BLINK_MS = 60; // 켜짐·꺼짐 한 번의 길이
const HURT_VIGNETTE_MS = 380; // 화면 가장자리 붉은 번짐이 사라지는 시간

// 왼쪽 위 HUD: 초상 카드 + HP 바. 맨 윗줄이 나, 그 아래가 상대(또는 짝).
// 값은 폰 가로 기준이고, 화면 크기에 따라 UI 배율(ui.ts)을 곱해 쓴다.
function hudLayout(s: number) {
  const cardW = 52 * s; // 초상 카드 크기
  const cardH = 62 * s;
  const cardX = 8 * s + cardW / 2; // 화면 왼쪽에서 8px 띄운 카드의 가운데
  const barX = cardX + cardW / 2 + 8 * s; // HP 바는 카드 오른쪽에서 시작
  return { s, cardW, cardH, cardX, barX, barW: 128 * s, rowY: (slot: 0 | 1) => 8 * s + cardH / 2 + slot * (cardH + 6 * s) };
}

// 직전 프레임에 본 탄. 사라진 탄을 찾아 명중 연출을 내는 데 쓴다
interface BulletMemo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  color: number;
}

// 직전 프레임에 본 적. 사라진 적을 찾아 처치 연출을 낸다
interface EnemyMemo {
  x: number;
  y: number;
  hp: number;
  kind: 0 | 1 | 2;
}

export class ArenaScene extends Phaser.Scene {
  private sync!: GameSync;
  private session?: Session;
  private unsubscribes: Unsubscribe[] = []; // 장면을 떠날 때 풀 구독들
  private accumulator = 0; // 아직 시뮬레이션하지 않은 실제 경과 시간 (초)

  private world!: Phaser.GameObjects.Container; // 경기장 좌표계 (1280×720을 화면에 맞춰 확대·축소)
  private gfx!: Phaser.GameObjects.Graphics; // 경기장 안 모든 도형을 매 프레임 여기에 다시 그린다
  private nameLabels!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text]; // 캐릭터 머리 위 이름
  private hud: Phaser.GameObjects.Text | null = null; // ?debug=1 진단 줄
  private hudGfx!: Phaser.GameObjects.Graphics; // HP 바
  private banner!: Phaser.GameObjects.Text; // 위쪽 가운데 안내 (웨이브·코어 등)
  private waveText!: Phaser.GameObjects.Text; // 가운데 큰 글자 (WAVE 3)
  private hudMe!: Phaser.GameObjects.Text; // 내 HP 바 옆 "나" 표시
  private slowWarn!: Phaser.GameObjects.Text; // 호스트가 느릴 때 경고
  private hurtVignette!: Phaser.GameObjects.Graphics;
  private focusWarn!: Phaser.GameObjects.Text;
  private hurtAt = -1e9; // 내가 마지막으로 맞은 시각 (붉은 번짐용)
  private lastMove: [number, number] = [0, 0]; // 마지막 이동 입력 (경기 기록용)
  // 조준 보정: 협동과 봇 상대 대전에서만. 사람끼리의 대전은 조준 실력이 승부라 쓰지 않는다
  private assist = false;
  private assistPos: { x: number; y: number } | null = null; // 보정이 붙은 적 위치 (흰 고리)
  private recorder!: MatchRecorder;
  private slowFrames = 0; // 호스트: 연속으로 느린 프레임 수
  private slowSince = 0; // 느림이 시작된 시각 (1초 넘게 이어져야 경고)
  private recordTick = 0; // 기록용 틱 카운터
  private waitingSince = 0; // 참가한 쪽: 첫 스냅샷을 기다리기 시작한 시각
  private hudL = hudLayout(1);
  private hudPortraits: [Phaser.GameObjects.Container | null, Phaser.GameObjects.Container | null] = [null, null];
  private hudPortraitIds: [CharacterId | null, CharacterId | null] = [null, null]; // 지금 그려 둔 초상이 누구인지 (바뀔 때만 새로 만든다)
  private reconnectShade!: Phaser.GameObjects.Rectangle; // 재접속 중 화면을 덮는 어두운 막
  private reconnectText!: Phaser.GameObjects.Text;
  private ended = false;
  private moveStick!: VirtualStick;
  private aimStick!: VirtualStick;
  private desktop!: DesktopControls;
  private weaponButton!: Phaser.GameObjects.Text;
  private dashButton!: Phaser.GameObjects.Text;
  private exitButton!: Phaser.GameObjects.Text;
  private lastRender: RenderState | null = null; // 직전에 그린 상태 (입력의 조준 기준점)
  private dashPressed = false; // DASH 버튼을 눌렀다 (다음 틱에 한 번 보낸다)
  private swapRequest = 0; // 무기 버튼을 눌렀다 (1~3)

  private readonly fx = new Fx();
  private worldScale = 1; // 경기장 → 화면 배율
  private baseX = 0; // 경기장이 화면에서 시작하는 위치 (가운데 정렬 여백)
  private baseY = 0;
  private seen = false; // 첫 프레임을 봤는가 (첫 프레임에는 모든 것이 '새로' 보이므로 연출을 내지 않는다)
  private prevBullets = new Map<number, BulletMemo>();
  private prevEnemies = new Map<number, EnemyMemo>();
  private prevPickups = new Set<number>();
  private prevHp: [number, number] = [0, 0];
  private prevDash: [number, number] = [0, 0];
  private prevWeapon: [number, number] = [0, 0];
  private prevBoost: [number, number] = [0, 0];
  private prevPos: [{ x: number; y: number } | null, { x: number; y: number } | null] = [null, null]; // 이동 방향 계산용
  private trail: [{ x: number; y: number }, { x: number; y: number }] = [{ x: -1, y: 0 }, { x: 1, y: 0 }]; // 머리카락이 흐르는 방향
  private prevCoreHp = 0;
  private prevPhase = -1;
  private readonly flashUntil = new Map<string, number>(); // 'p0'·'e12'·'core' → 번쩍임이 끝나는 시각
  private wakeLock: WakeLockSentinel | null = null; // 화면 꺼짐 방지 잠금
  private perfSamples = 0;
  private perfElapsed = 0;
  private perfDecided = false;

  constructor() {
    super('Arena');
  }

  private async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wakeLock) return; // 지원하지 않거나 이미 잡았다
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => (this.wakeLock = null)); // 탭을 가리면 브라우저가 풀어 버린다
    } catch {
      this.wakeLock = null;
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.acquireWakeLock(); // 돌아오면 다시 잡는다
  };

  // 처음 3초 동안 프레임 시간을 재서 느리면 파티클을 줄인다.
  private samplePerformance(deltaMs: number): void {
    if (this.perfDecided) return;
    this.perfSamples += 1;
    this.perfElapsed += deltaMs;
    if (this.perfElapsed < 3000) return;
    this.perfDecided = true;
    const fps = (this.perfSamples * 1000) / this.perfElapsed;
    const lowMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8; // 기기 메모리(GB). 모르면 넉넉하다고 본다
    this.fx.quality = fps < 40 ? 0.35 : fps < 52 || lowMemory <= 2 ? 0.6 : 1; // 느릴수록 파티클을 줄인다
  }

  create(data: ArenaData): void {
    const local = selectedCharacter(this);
    const mode = selectedMode(this);
    const weapon = selectedLoadout(this, local);
    // 재경기로 같은 장면을 다시 쓰므로 이전 경기의 값을 모두 비운다
    this.accumulator = 0;
    this.unsubscribes = [];
    this.ended = false;
    this.seen = false;
    this.prevBullets.clear();
    this.prevEnemies.clear();
    this.prevPickups.clear();
    this.flashUntil.clear();
    this.prevPos = [null, null];

    if (data.mode === 'versus') {
      const session = data.session;
      this.session = session;
      this.sync = session.role === 'host' ? new HostSync(session, local, mode, weapon) : new GuestSync(session, local, weapon);
      this.unsubscribes.push(session.onMessage((channel, bytes) => this.sync.handleMessage(channel, bytes)));
      this.unsubscribes.push(session.on('reconnected', () => this.sync.resync()));
      this.unsubscribes.push(session.on('failed', (reason) => this.endByDisconnect(reason ?? 'rejoin_failed')));
      if (session.state === 'failed') this.time.delayedCall(0, () => this.endByDisconnect(session.failReason ?? 'rejoin_failed'));
      if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __link?: Session }).__link = session;
    } else {
      this.session = undefined;
      this.sync = new SoloSync(local, mode, weapon, selectedDifficulty(this));
    }

    // 경기장 안의 것(도형·이름표·피해 숫자)은 world에 넣어 경기장 배율을 함께 따르게 한다
    this.world = this.add.container(0, 0);
    this.gfx = this.add.graphics();
    this.world.add(this.gfx);
    this.nameLabels = [this.makeNameLabel(), this.makeNameLabel()];

    // 화면을 가리지 않도록 평소에는 초상 옆 HP 바만 그리고, 진단 정보는 ?debug=1 일 때만 보여준다
    const ui = uiScale(this);
    const u = (n: number) => px(this, n);
    this.hudL = hudLayout(ui);
    const hl = this.hudL;
    // 깊이(depth)가 클수록 위에 그려진다: 경기장 < 붉은 번짐 48 < HP 바 49 < 글자 50 < 버튼 102
    this.hudGfx = this.add.graphics().setDepth(49);
    this.hurtVignette = this.add.graphics().setDepth(48);
    this.hurtAt = -1e9;
    this.assist = aimAssistOn(this) && (mode === 'coop' || this.sync.kind === 'solo');
    this.assistPos = null;
    this.hud = new URLSearchParams(location.search).has('debug')
      ? this.add.text(hl.barX, hl.rowY(1) + hl.cardH / 2 + u(8), '', { fontFamily: FONT, fontSize: fontPx(this, 13), color: '#8fa3c8' }).setDepth(50)
      : null;
    this.recorder = new MatchRecorder({
      role: this.sync.kind,
      mode,
      localId: this.sync.localId,
      chose: { character: local, weapon },
      difficulty: this.sync.kind === 'solo' ? selectedDifficulty(this) : undefined,
      transport: this.session ? this.session.kind : 'none',
      userAgent: navigator.userAgent,
      viewport: Math.round(this.scale.width) + 'x' + Math.round(this.scale.height),
    });
    (window as unknown as { __record?: MatchRecorder }).__record = this.recorder; // 개발자 도구에서 기록을 바로 볼 수 있게
    this.sync.setEventSink(this.recorder.onSimEvent); // 피해·처치 사건이 기록기로 들어간다

    // 맨 위 줄이 내 것임을 못 박는다. 2인일 때만 보여준다.
    this.hudMe = this.add
      .text(hl.barX + hl.barW + u(6), hl.rowY(0), '나', { fontFamily: FONT, fontSize: fontPx(this, 12), color: '#8fa3c8' })
      .setOrigin(0, 0.5)
      .setDepth(50)
      .setVisible(false);
    this.hudPortraits = [null, null];
    this.hudPortraitIds = [null, null];
    this.banner = this.add
      .text(this.scale.width / 2, u(58), '', { fontFamily: FONT, fontSize: fontPx(this, 22), color: '#ffe066' })
      .setOrigin(0.5, 0)
      .setDepth(50);
    this.slowWarn = this.add
      .text(this.scale.width / 2, u(90), '', { fontFamily: FONT, fontSize: fontPx(this, 13), color: '#ff8a80' })
      .setOrigin(0.5, 0)
      .setDepth(50);
    // 키보드로 하는데 포커스가 주소창·다른 창에 가 있으면 키가 전혀 안 먹는다. 말없이 안 움직이면 버그로 보인다.
    this.focusWarn = this.add
      .text(this.scale.width / 2, this.scale.height - u(40), '키보드 입력이 게임에 닿지 않습니다 — 게임 화면을 한 번 클릭하세요', {
        fontFamily: FONT,
        fontSize: fontPx(this, TYPE.body),
        color: '#0b0f1a',
        backgroundColor: '#ffe066',
        padding: { x: u(14), y: u(8) },
      })
      .setOrigin(0.5)
      .setDepth(103)
      .setVisible(false);
    this.waveText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontFamily: FONT,
        fontSize: fontPx(this, 64),
        color: '#ffe066',
        stroke: '#000000',
        strokeThickness: u(6),
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setAlpha(0); // 평소엔 투명, 웨이브가 시작될 때 잠깐 나타났다 사라진다
    this.reconnectShade = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x05080f, 0.6)
      .setOrigin(0)
      .setDepth(70)
      .setVisible(false);
    this.reconnectText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', { fontFamily: FONT, fontSize: fontPx(this, 26), color: '#ffffff', align: 'center' })
      .setOrigin(0.5)
      .setDepth(71)
      .setVisible(false);

    // 스틱보다 먼저 등록해야 같은 포인터 이벤트에서 스틱이 마우스를 잡기 전에 터치 전용으로 전환된다.
    this.desktop = new DesktopControls(this, (active) => {
      this.moveStick.touchOnly = active;
      this.aimStick.touchOnly = active;
    });
    this.moveStick = new VirtualStick(this, 'left', u(60));
    this.aimStick = new VirtualStick(this, 'right', u(60));
    this.moveStick.touchOnly = this.desktop.active; // 재경기면 이미 PC 조작이 켜져 있을 수 있다
    this.aimStick.touchOnly = this.desktop.active;
    this.lastRender = null;

    const dash = makeButton(this, this.scale.width - u(90), this.scale.height * 0.35, 'DASH', () => {});
    dash.setDepth(102);
    this.dashButton = dash;
    dash.on('pointerdown', () => (this.dashPressed = true)); // 손을 뗄 때가 아니라 누르는 순간 반응 (회피는 빨라야 한다)

    // 무기 교체: 탭하면 다음 기본 무기로, PC는 1~3 키
    this.weaponButton = makeButton(this, this.scale.width - u(90), this.scale.height * 0.5, '', () => {}, 14).setDepth(102);
    this.weaponButton.on('pointerdown', () => {
      const options = LOADOUTS[local];
      const current = this.lastRender?.players[this.sync.localId].baseWeapon ?? options[0]!;
      const next = (options.indexOf(current) + 1) % options.length; // 다음 무기로 순환
      this.swapRequest = next + 1; // 입력의 swapTo는 1부터 센다
    });

    this.exitButton = sizeButton(makeButton(this, this.scale.width - u(60), u(30), '✕', () => this.exit(), TYPE.button), 44, 40).setDepth(102);

    this.scale.on('resize', this.layout, this); // 창 크기·화면 방향이 바뀌면 다시 배치
    this.layout();
    this.events.once('shutdown', this.cleanup, this);

    this.perfSamples = 0;
    this.perfElapsed = 0;
    this.perfDecided = false;
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // 매 화면 프레임(보통 60fps, 기기마다 다름). 시뮬레이션은 프레임률과 무관하게 60Hz 고정 틱으로 돈다

  update(_time: number, deltaMs: number): void {
    if (this.ended) return;
    this.samplePerformance(deltaMs);
    // 재접속 중에는 시뮬레이션을 멈춘다. 호스트가 멈추므로 복구 후 그 시점부터 이어진다.
    if (this.session && !this.session.connected) {
      this.accumulator = 0;
      this.renderReconnectOverlay();
      this.fx.update(deltaMs);
      this.render();
      return;
    }
    // 참가한 쪽은 첫 스냅샷이 오기 전까지 진짜 월드를 모른다. 그 상태로 그리면 임시 초기값이
    // 실제 경기처럼 보여서(두 캐릭터가 같거나 웨이브가 없는 화면) 연결 실패를 알아챌 수 없다.
    if (this.waitingForAuthority()) {
      this.accumulator = 0;
      this.fx.update(deltaMs);
      return;
    }
    this.hideReconnectOverlay();
    this.checkSlowHost(deltaMs);
    // 고정 틱 누산기: 흐른 실제 시간을 모아 두었다가 1/60초씩 꺼내 시뮬레이션한다.
    // 한 프레임에 100ms 넘게 걸려도 100ms만 인정한다(탭이 멈췄다 돌아왔을 때 수백 틱을 몰아 돌지 않게)
    this.accumulator += Math.min(deltaMs, 100) / 1000;
    while (this.accumulator >= SIM.dt) {
      this.accumulator -= SIM.dt;
      const input = this.readLocalInput();
      this.lastMove = [input.moveX, input.moveY];
      this.sync.step(input);
      this.sampleRecord();
      const outcome = this.sync.outcome();
      if (outcome !== null) {
        this.finish(outcome);
        return;
      }
    }
    this.fx.update(deltaMs); // 연출은 실제 시간으로
    this.render();
  }

  // 경기 끝: 결과 화면으로 요약과 기록을 넘긴다
  private finish(outcome: Outcome, note?: string): void {
    if (this.ended) return; // 한 번만
    this.ended = true;
    this.recorder.event(this.recordTick, 'end', note ?? JSON.stringify(outcome));
    this.scene.start('Result', {
      outcome,
      summary: this.sync.summary(),
      localId: this.sync.localId,
      session: this.session,
      note,
      recorder: this.recorder,
    });
  }

  // 복구 실패: 상대가 떠났으면(peer_left) 내가 남은 쪽, 내 재접속이 실패했으면 내가 떨어진 쪽이다.
  private endByDisconnect(reason: FailReason): void {
    const rs = this.sync.renderState(performance.now());
    const remaining = reason === 'peer_left'; // 내가 남은 쪽인가
    const localId = this.sync.localId;
    const outcome: Outcome =
      rs.mode === 'coop'
        ? { mode: 'coop', won: false, wave: rs.coop?.wave ?? 0 }
        : { mode: 'duel', winner: remaining ? localId : localId === 0 ? 1 : 0 };
    this.finish(
      outcome,
      this.sync.kind === 'guest' && !(this.sync as GuestSync).hasAuthority
        ? '호스트와 데이터가 오가지 않아 시작하지 못했습니다'
        : remaining
          ? '상대의 연결이 끊겼습니다'
          : '연결을 복구하지 못했습니다',
    );
  }

  // 첫 권위 스냅샷을 기다리는 동안은 화면을 가려 둔다. 너무 오래 걸리면 연결 실패로 끝낸다.
  private waitingForAuthority(): boolean {
    if (this.sync.kind !== 'guest' || (this.sync as GuestSync).hasAuthority) {
      this.waitingSince = 0;
      return false;
    }
    const now = performance.now();
    if (this.waitingSince === 0) this.waitingSince = now;
    const waited = now - this.waitingSince;
    if (waited > AUTHORITY_TIMEOUT_MS) {
      this.recorder.event(this.recordTick, 'no-authority', this.session?.kind ?? 'none');
      this.endByDisconnect('rejoin_failed');
      return true;
    }
    const left = Math.max(0, Math.ceil((AUTHORITY_TIMEOUT_MS - waited) / 1000)); // 남은 초
    this.reconnectShade.setVisible(true);
    this.reconnectText
      .setVisible(true)
      .setText(
        `호스트와 데이터가 아직 오가지 않습니다… (${left})\n방을 만든 기기와 같은 Wi‑Fi인지 확인하세요`,
      );
    return true;
  }

  private renderReconnectOverlay(): void {
    const remain = Math.max(0, Math.ceil((this.session!.deadline - performance.now()) / 1000)); // 재접속을 포기하기까지 남은 초
    this.reconnectShade.setVisible(true);
    this.reconnectText.setVisible(true).setText(`재연결 중… (${remain})\n연결이 복구되면 그 시점부터 이어집니다`);
  }

  private hideReconnectOverlay(): void {
    if (!this.reconnectShade.visible) return;
    this.reconnectShade.setVisible(false);
    this.reconnectText.setVisible(false);
  }

  private makeNameLabel(): Phaser.GameObjects.Text {
    const label = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5, 1); // 아래 가운데가 기준점: 머리 위에 붙인다
    this.world.add(label); // 경기장 안에 넣어 경기장 배율을 따른다 (그래서 px 배율을 따로 곱하지 않는다)
    return label;
  }

  // 이번 틱의 내 입력: 터치 스틱과 키보드·마우스를 하나의 InputFrame으로 합친다
  private readLocalInput(): InputFrame {
    const move = this.moveStick.vector;
    const aim = this.aimStick.vector;
    const frame: InputFrame = {
      moveX: move.x,
      moveY: move.y,
      aimX: aim.x,
      aimY: aim.y,
      fire: aim.magnitude > 0.3, // 조준 스틱을 30% 넘게 밀면 자동 연사
      dash: this.dashPressed,
      skill: false,
      swapTo: this.swapRequest,
    };
    this.dashPressed = false; // 버튼 입력은 한 틱만 싣고 비운다
    this.swapRequest = 0;

    const me = this.lastRender?.players[this.sync.localId];
    const desk = me ? this.desktop.read(this.baseX + me.x * this.worldScale, this.baseY + me.y * this.worldScale) : null; // 내 캐릭터의 화면 좌표를 조준 기준으로
    if (desk) {
      // 키를 누르고 있거나 스틱을 안 쓰는 중이면 키보드 이동을 쓴다 (둘을 섞어 써도 자연스럽게)
      if (desk.moveX !== 0 || desk.moveY !== 0 || !this.moveStick.active) {
        frame.moveX = desk.moveX;
        frame.moveY = desk.moveY;
      }
      if (!this.aimStick.active) {
        frame.aimX = desk.aimX;
        frame.aimY = desk.aimY;
        frame.fire = desk.fire;
      }
      frame.dash = frame.dash || desk.dash;
      if (desk.swapTo > 0) frame.swapTo = desk.swapTo;
    }
    this.applyAssist(frame, me ?? null);
    return frame;
  }

  // 쏘는 중이면 조준 방향 앞 18도 안의 적에게 조준을 붙인다. 기준은 내 화면에 보이는 위치다.
  private applyAssist(frame: InputFrame, me: PlayerState | null): void {
    this.assistPos = null;
    const rs = this.lastRender;
    if (!this.assist || !me || !rs || me.hp <= 0 || !frame.fire) return;
    const targets: AssistTarget[] =
      rs.mode === 'coop'
        ? (rs.coop?.enemies ?? [])
        : rs.players.filter((p) => p.id !== this.sync.localId && p.hp > 0); // 봇 상대 대전이면 상대 한 명
    const r = assistAim(me.x, me.y, frame.aimX, frame.aimY, targets);
    if (r.index < 0) return; // 18도 안에 적이 없다: 조준 그대로
    frame.aimX = r.aimX;
    frame.aimY = r.aimY;
    this.assistPos = { x: targets[r.index]!.x, y: targets[r.index]!.y };
  }

  // 렌더 상태를 프레임 간 비교해 연출 이벤트를 만든다. 솔로/호스트/게스트 모두 같은 경로를 탄다.
  private detectEvents(rs: RenderState, now: number): void {
    const first = !this.seen; // 첫 프레임에는 비교할 이전 상태가 없다
    this.seen = true;

    const bullets = new Map<number, BulletMemo>();
    for (const b of rs.bullets) {
      const color = this.bulletColor(b, rs);
      bullets.set(b.id, { x: b.x, y: b.y, vx: b.vx, vy: b.vy, ttl: b.ttl, color });
      if (!first && !this.prevBullets.has(b.id)) {
        // 새로 보인 탄 = 방금 발사됨: 총구 화염과 무기별 발사음
        this.fx.muzzle(b.x - b.vx * SIM.dt, b.y - b.vy * SIM.dt, Math.atan2(b.vy, b.vx), color);
        if (b.owner === ENEMY_OWNER) sfx.enemyShot();
        else if (b.kind === 1 || b.kind === 5) sfx.shotgun();
        else if (b.kind === 2) sfx.laser();
        else if (b.kind === 4) sfx.snipe();
        else sfx.shot();
      }
    }
    if (!first) {
      for (const [id, b] of this.prevBullets) {
        if (bullets.has(id)) continue;
        // 사라진 탄: 수명이 남았고 경기장 안이었다면 무언가에 맞은 것
        const inside = b.x > 2 && b.y > 2 && b.x < SIM.arenaW - 2 && b.y < SIM.arenaH - 2;
        if (b.ttl > 2 && inside) {
          this.fx.burst(b.x, b.y, b.color, 6, 200, 220, 2.5);
          sfx.hit();
        }
      }
    }
    this.prevBullets = bullets;

    for (const p of rs.players) {
      if (p.id >= rs.playerCount) continue;
      const color = CHARACTERS[p.character].color;
      if (!first) {
        const prevHp = this.prevHp[p.id];
        if (p.hp < prevHp) {
          // 체력이 줄었다 = 맞았다
          this.flashUntil.set(`p${p.id}`, now + HURT_FLASH_MS);
          this.popDamage(p.x, p.y, prevHp - p.hp);
          if (p.id === this.sync.localId) this.hurtAt = now;
          this.fx.burst(p.x, p.y, 0xff5252, 8, 180, 260, 2.5);
          if (p.hp <= 0) {
            // 쓰러졌다: 큰 폭발과 강한 흔들림
            this.fx.burst(p.x, p.y, color, 36, 340, 700, 4, 0.94);
            this.fx.ring(p.x, p.y, color, 110, 500, 5);
            this.fx.shake(8, 320);
            sfx.down();
          } else {
            this.fx.ring(p.x, p.y, 0xff5252, 40, 220, 2);
            this.fx.shake(p.id === this.sync.localId ? 3 : 1.5, 110); // 내가 맞으면 더 세게 흔들린다
            if (p.id === this.sync.localId) sfx.hurt();
          }
        } else if (p.hp > prevHp && prevHp > 0) {
          // 체력이 늘었다 = 리페어 팩
          this.fx.burst(p.x, p.y, 0x69f0ae, 12, 120, 400, 2.5);
          sfx.pickup();
        } else if (p.hp > 0 && prevHp <= 0) {
          // 0에서 살아났다 = 부활
          this.fx.ring(p.x, p.y, 0x69f0ae, 90, 500, 4);
          this.fx.burst(p.x, p.y, 0x69f0ae, 24, 200, 500, 3);
          sfx.revive();
        }
        if (p.hp > 0 && p.dashTicks > 0 && this.prevDash[p.id] === 0) sfx.dash();
        if (p.weapon !== this.prevWeapon[p.id] && p.weaponTicks > 0) {
          // 픽업 무기를 새로 들었다
          this.fx.ring(p.x, p.y, WEAPONS[p.weapon].color, 70, 400, 3);
          this.fx.burst(p.x, p.y, WEAPONS[p.weapon].color, 14, 160, 400, 2.5);
          sfx.pickup();
        }
        if (p.boostTicks > 0 && this.prevBoost[p.id] === 0) {
          this.fx.ring(p.x, p.y, PICKUP_COLORS[3], 70, 400, 3);
          sfx.pickup();
        }
      }
      if (p.hp > 0 && (p.dashTicks > 0 || p.boostTicks > 0)) this.fx.ghost(p.x, p.y, SIM.playerRadius * 1.1, color);
      this.prevHp[p.id] = p.hp;
      this.prevDash[p.id] = p.dashTicks;
      this.prevWeapon[p.id] = p.weapon;
      this.prevBoost[p.id] = p.boostTicks;
    }

    if (!first) {
      for (const id of this.prevPickups) {
        if (rs.pickups.some((pk) => pk.id === id)) continue; // 아직 있는 픽업
        for (const p of rs.players) {
          if (p.id < rs.playerCount && p.hp > 0) {
            this.fx.burst(p.x, p.y, 0x69f0ae, 10, 150, 400, 2.5);
            break;
          }
        }
      }
    }
    this.prevPickups = new Set(rs.pickups.map((pk) => pk.id));

    const coop = rs.coop;
    if (coop) {
      const enemies = new Map<number, EnemyMemo>();
      for (const e of coop.enemies) {
        enemies.set(e.id, { x: e.x, y: e.y, hp: e.hp, kind: e.kind });
        const prev = this.prevEnemies.get(e.id);
        if (!first && !prev) this.fx.ring(e.x, e.y, ENEMIES[e.kind].color, ENEMIES[e.kind].radius + 22, 350, 2); // 새 적 등장
        if (prev && e.hp < prev.hp) this.flashUntil.set(`e${e.id}`, now + FLASH_MS); // 맞은 적은 번쩍
      }
      if (!first) {
        for (const [id, prev] of this.prevEnemies) {
          if (enemies.has(id)) continue;
          // 사라진 적 = 처치됨: 폭발
          const spec = ENEMIES[prev.kind];
          this.fx.burst(prev.x, prev.y, spec.color, 10 + spec.radius, 260, 520, 3.5, 0.93);
          this.fx.ring(prev.x, prev.y, 0xffffff, spec.radius + 30, 320, 3);
          this.fx.shake(prev.kind === 2 ? 6 : 2.5, 150);
          sfx.explode(prev.kind === 2);
        }
        if (coop.coreHp < this.prevCoreHp) {
          this.fx.ring(COOP.coreX, COOP.coreY, 0xff5252, COOP.coreRadius + 30, 300, 4);
          this.fx.shake(4, 160);
          this.flashUntil.set('core', now + FLASH_MS);
          sfx.coreHit();
        }
        if (coop.phase === 1 && this.prevPhase === 0) {
          // 대기 → 스폰: 새 웨이브 시작
          this.showWaveText(`WAVE ${coop.wave}`);
          sfx.wave();
        }
        if (coop.phase === 0 && this.prevPhase === 2) {
          // 소탕 → 대기: 웨이브를 막았다
          this.showWaveText('WAVE CLEAR');
          sfx.revive();
        }
      }
      this.prevEnemies = enemies;
      this.prevCoreHp = coop.coreHp;
      this.prevPhase = coop.phase;
    }
  }

  // 탄 색: 적 탄은 주황, 픽업·특수 무기는 무기 색, 기본 무기는 협동이면 파티마 색(누구 탄인지), 대전이면 노랑
  private bulletColor(b: BulletState, rs: RenderState): number {
    if (b.owner === ENEMY_OWNER) return ENEMY_BULLET_COLOR;
    if (b.kind !== 0) return WEAPONS[b.kind].color;
    return rs.mode === 'coop' ? CHARACTERS[rs.players[b.owner].character].color : PLAYER_BULLET_COLOR;
  }

  private showWaveText(text: string): void {
    this.tweens.killTweensOf(this.waveText); // 앞 애니메이션이 남아 있으면 끊는다
    this.waveText.setText(text).setAlpha(1).setScale(1.8); // 크게 나타나 제자리 크기로 튕기듯 줄어든 뒤 사라진다
    this.tweens.add({ targets: this.waveText, scale: 1, duration: 320, ease: 'Back.Out' });
    this.tweens.add({ targets: this.waveText, alpha: 0, delay: 1100, duration: 400 });
  }

  private flashing(key: string, now: number): boolean {
    const until = this.flashUntil.get(key);
    if (until === undefined || until <= now) return false;
    // 플레이어는 깜빡이고, 적과 코어는 한 번 번쩍인다
    if (key.startsWith('p')) return Math.floor((until - now) / HURT_BLINK_MS) % 2 === 0;
    return true;
  }

  // 맞은 자리에서 피해량이 떠올랐다 사라진다. 경기장 좌표에 붙어 경기장 배율을 따른다.
  private popDamage(x: number, y: number, amount: number): void {
    const t = this.add
      .text(x, y - 26, `-${amount}`, { fontFamily: FONT, fontSize: '20px', color: '#ff6b6b', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5);
    this.world.add(t);
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // 내가 맞으면 화면 가장자리가 붉게 번졌다가 빠진다. 캐릭터가 작은 폰 화면에서도 맞았다는 걸 놓치지 않게.
  private renderHurtVignette(now: number): void {
    const g = this.hurtVignette;
    g.clear();
    const t = (now - this.hurtAt) / HURT_VIGNETTE_MS;
    if (t < 0 || t >= 1) return;
    const { width, height } = this.scale;
    const band = px(this, 26); // 번짐 띠의 폭
    // 가장자리에서 안쪽으로 네 겹을 점점 옅게 그려 번지는 느낌을 낸다
    for (let i = 0; i < 4; i++) {
      const inset = (band / 4) * i;
      g.lineStyle(band / 4, 0xff3b3b, (1 - t) * 0.42 * (1 - i / 4));
      g.strokeRect(inset + band / 8, inset + band / 8, width - 2 * inset - band / 4, height - 2 * inset - band / 4);
    }
  }

  // 한 프레임 그리기: 연출 감지 → 배경 → 협동(코어·적) → 캐릭터 → 픽업 → 탄 → 조준 가이드 → 앞 효과 → HUD
  private render(): void {
    const now = performance.now();
    const rs = this.sync.renderState(now);
    this.lastRender = rs;
    this.detectEvents(rs, now);
    this.renderHurtVignette(now);
    this.focusWarn.setVisible(this.desktop.active && !this.desktop.hasFocus);

    const shake = this.fx.shakeOffset();
    this.world.setPosition(this.baseX + shake.x * this.worldScale, this.baseY + shake.y * this.worldScale); // 화면 흔들림은 경기장 전체를 옮겨서 낸다

    const g = this.gfx;
    g.clear(); // 매 프레임 처음부터 다시 그린다 (즉시 모드 그리기)
    this.renderBackground(now);
    if (rs.mode === 'coop' && rs.coop) this.renderCoop(rs, now);
    this.fx.drawBehind(g);

    for (const p of rs.players) {
      const label = this.nameLabels[p.id];
      if (p.id >= rs.playerCount) {
        label.setVisible(false);
        continue;
      }
      label.setVisible(true);
      this.renderPlayer(p, rs, now);
    }

    this.renderPickups(rs, now);

    for (const b of rs.bullets) {
      const color = this.bulletColor(b, rs);
      const laser = b.kind === 2 || b.kind === 4; // 레이저 랜스·버스터 런처는 굵고 긴 궤적
      const trail = laser ? 5 : b.kind === 1 || b.kind === 5 ? 2 : 3; // 꼬리 길이 (틱 수만큼 뒤로)
      const tx = b.x - b.vx * SIM.dt * trail;
      const ty = b.y - b.vy * SIM.dt * trail;
      g.lineStyle(laser ? 12 : 7, color, laser ? 0.25 : 0.18); // 바깥 번짐
      g.lineBetween(tx, ty, b.x, b.y);
      g.lineStyle(laser ? 4 : 2.5, color, 0.85); // 속 심지
      g.lineBetween(tx, ty, b.x, b.y);
      g.fillStyle(0xffffff, 1); // 탄 머리는 흰 점
      g.fillCircle(b.x, b.y, b.kind === 1 || b.kind === 5 || b.kind === 3 ? SIM.bulletRadius - 2 : SIM.bulletRadius - 1);
    }

    if (this.desktop.active) this.renderAimGuide(rs, now);
    this.fx.drawFront(g);
    // 보정이 붙은 적에 얇은 고리를 둘러 어디로 쏘고 있는지 보여 준다
    if (this.assistPos) {
      g.lineStyle(2, 0xffffff, 0.55);
      g.strokeCircle(this.assistPos.x, this.assistPos.y, 30);
    }
    this.renderHud(rs);
  }

  // PC 조작: 내 캐릭터에서 커서까지 점선 가이드와 커서 위치의 레티클을 그린다.
  private renderAimGuide(rs: RenderState, now: number): void {
    const me = rs.players[this.sync.localId];
    if (me.hp <= 0) return;
    const pointer = this.input.activePointer;
    const mx = (pointer.x - this.baseX) / this.worldScale; // 화면 좌표 → 경기장 좌표
    const my = (pointer.y - this.baseY) / this.worldScale;
    const color = CHARACTERS[me.character].color;
    const g = this.gfx;

    const dx = mx - me.x;
    const dy = my - me.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SIM.playerRadius + 24) {
      const ux = dx / dist;
      const uy = dy / dist;
      const start = SIM.playerRadius + 14;
      const end = dist - 16;
      g.lineStyle(1.5, color, 0.3);
      for (let d = start; d < end; d += 22) {
        const len = Math.min(12, end - d);
        g.lineBetween(me.x + ux * d, me.y + uy * d, me.x + ux * (d + len), me.y + uy * (d + len));
      }
    }

    const firing = pointer.leftButtonDown() && !pointer.wasTouch;
    const r = (firing ? 13 : 10) + Math.sin(now / 120) * (firing ? 1.5 : 0.5); // 쏘는 중엔 레티클이 커지고 더 크게 맥동한다
    g.lineStyle(2, color, 0.9);
    g.strokeCircle(mx, my, r);
    g.lineStyle(2, color, 0.9);
    for (const [ax, ay] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      // 원 바깥 네 방향의 짧은 눈금
      g.lineBetween(mx + ax * (r + 3), my + ay * (r + 3), mx + ax * (r + 9), my + ay * (r + 9));
    }
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(mx, my, 1.6);
  }

  private renderBackground(now: number): void {
    const g = this.gfx;
    g.lineStyle(1, 0x3a4a72, 0.12); // 80px 격자: 움직임을 가늠하는 바닥 무늬
    for (let x = 80; x < SIM.arenaW; x += 80) g.lineBetween(x, 0, x, SIM.arenaH);
    for (let y = 80; y < SIM.arenaH; y += 80) g.lineBetween(0, y, SIM.arenaW, y);
    const pulse = 0.35 + 0.15 * Math.sin(now / 600); // 경기장 테두리가 천천히 숨 쉬듯 밝아졌다 어두워진다
    g.lineStyle(10, 0x4cc9f0, pulse * 0.25);
    g.strokeRect(0, 0, SIM.arenaW, SIM.arenaH);
    g.lineStyle(2, 0x4cc9f0, pulse);
    g.strokeRect(0, 0, SIM.arenaW, SIM.arenaH);
  }

  // 머리카락은 조준 반대 방향을 기본으로, 움직일 때는 이동 반대 방향으로 부드럽게 기운다.
  private updateTrail(p: PlayerState): { x: number; y: number } {
    const prev = this.prevPos[p.id];
    let dx = -Math.cos(p.aimAngle); // 기본: 조준 반대쪽으로 흐른다
    let dy = -Math.sin(p.aimAngle);
    if (prev) {
      const vx = p.x - prev.x;
      const vy = p.y - prev.y;
      const speed = Math.hypot(vx, vy);
      if (speed > 0.8) {
        const w = Math.min(1, speed / 6); // 빠를수록 이동 반대쪽을 더 따른다
        dx = dx * (1 - w) - (vx / speed) * w;
        dy = dy * (1 - w) - (vy / speed) * w;
      }
    }
    this.prevPos[p.id] = { x: p.x, y: p.y };
    const cur = this.trail[p.id];
    cur.x += (dx - cur.x) * 0.15; // 목표 방향으로 15%씩 따라가 부드럽게 휘날린다
    cur.y += (dy - cur.y) * 0.15;
    const len = Math.hypot(cur.x, cur.y) || 1;
    return { x: cur.x / len, y: cur.y / len };
  }

  private renderPlayer(p: PlayerState, rs: RenderState, now: number): void {
    const g = this.gfx;
    const character = CHARACTERS[p.character];
    const alive = p.hp > 0;
    const flash = this.flashing(`p${p.id}`, now);
    const trail = this.updateTrail(p);

    if (alive) {
      g.fillStyle(character.color, 0.12); // 발밑의 고유색 후광: 멀리서도 누구인지 보인다
      g.fillCircle(p.x, p.y, SIM.playerRadius * 2);
    }
    drawFatima(g, LOOKS[p.character], {
      x: p.x,
      y: p.y,
      aim: p.aimAngle,
      trailX: trail.x,
      trailY: trail.y,
      time: now,
      scale: 1.15,
      alpha: alive ? 1 : 0.35,
      flash,
    });
    if (p.dashTicks > 0) {
      g.lineStyle(2, 0xffffff, 0.7); // 대시(무적) 중 표시
      g.strokeCircle(p.x, p.y, SIM.playerRadius + 8);
    }
    if (!alive && rs.mode === 'coop') {
      // 부활 진행도: 12시 방향에서 시계 방향으로 차오르는 호, 바깥의 옅은 원은 부활 반경
      g.lineStyle(3, 0x69f0ae, 0.9);
      g.beginPath();
      g.arc(p.x, p.y, SIM.playerRadius + 8, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * p.reviveProgress) / COOP.reviveTicks);
      g.strokePath();
      g.lineStyle(1, 0x69f0ae, 0.25);
      g.strokeCircle(p.x, p.y, COOP.reviveRadius);
    }
    const label = this.nameLabels[p.id];
    label.setPosition(p.x, p.y - SIM.playerRadius - 6).setAlpha(alive ? 1 : 0.5);
    const tag = p.id === this.sync.localId ? ' (나)' : '';
    label.setText(alive ? `${character.name}${tag}` : `${character.name}${tag} 다운`);
  }

  private renderCoop(rs: RenderState, now: number): void {
    const g = this.gfx;
    const coop = rs.coop!;

    const coreRatio = coop.coreHp / COOP.coreMaxHp;
    const coreColor = coreRatio > 0.3 ? 0x4cc9f0 : 0xff5252; // 30% 밑이면 빨갛게 (위험)
    const pulse = COOP.coreRadius + 8 + Math.sin(now / 350) * 4;
    g.fillStyle(coreColor, 0.08);
    g.fillCircle(COOP.coreX, COOP.coreY, pulse + 18);
    g.lineStyle(2, coreColor, 0.3);
    g.strokeCircle(COOP.coreX, COOP.coreY, pulse);
    g.fillStyle(this.flashing('core', now) ? 0xff8a80 : 0x1e3a5f, 1);
    g.fillCircle(COOP.coreX, COOP.coreY, COOP.coreRadius);
    g.lineStyle(4, coreColor, 1);
    g.strokeCircle(COOP.coreX, COOP.coreY, COOP.coreRadius);
    g.fillStyle(coreColor, 0.6);
    g.fillCircle(COOP.coreX, COOP.coreY, 10 + Math.sin(now / 200) * 2);
    // 코어 아래 HP 바
    g.fillStyle(0x000000, 0.5);
    g.fillRect(COOP.coreX - 50, COOP.coreY + COOP.coreRadius + 8, 100, 8);
    g.fillStyle(coreColor, 1);
    g.fillRect(COOP.coreX - 50, COOP.coreY + COOP.coreRadius + 8, 100 * coreRatio, 8);

    for (const e of coop.enemies) {
      const spec = ENEMIES[e.kind];
      const flash = this.flashing(`e${e.id}`, now);
      const color = flash ? 0xffffff : spec.color;
      g.fillStyle(spec.color, 0.12);
      g.fillCircle(e.x, e.y, spec.radius * 1.7);
      g.fillStyle(color, 1);
      if (e.kind === 1) g.fillRect(e.x - spec.radius, e.y - spec.radius, spec.radius * 2, spec.radius * 2); // 포수는 네모, 나머지는 원
      else g.fillCircle(e.x, e.y, spec.radius);
      if (e.kind === 2) {
        g.lineStyle(3, 0x000000, 0.35); // 강습병은 안쪽 고리로 구분
        g.strokeCircle(e.x, e.y, spec.radius * 0.55);
      }
      if (e.hp < spec.hp) {
        // 맞은 적만 머리 위에 HP 바를 보인다
        g.fillStyle(0x000000, 0.5);
        g.fillRect(e.x - spec.radius, e.y - spec.radius - 8, spec.radius * 2, 4);
        g.fillStyle(0xffffff, 0.9);
        g.fillRect(e.x - spec.radius, e.y - spec.radius - 8, (spec.radius * 2 * e.hp) / spec.hp, 4);
      }
    }
  }

  // 픽업 아이콘: 힐팩 십자, 산탄총 부채꼴 점 3개, 레이저 빛나는 막대, 부스트 이중 화살표
  private renderPickups(rs: RenderState, now: number): void {
    const g = this.gfx;
    for (const pk of rs.pickups) {
      const bob = Math.sin(now / 250 + pk.id) * 3; // 둥실 떠 있는 느낌 (id를 섞어 서로 박자가 다르게)
      const y = pk.y + bob;
      const color = PICKUP_COLORS[pk.kind];
      g.fillStyle(color, 0.18);
      g.fillCircle(pk.x, y, PICKUP.radius + 8 + Math.sin(now / 300 + pk.id) * 2);
      g.lineStyle(1.5, color, 0.6);
      g.strokeCircle(pk.x, y, PICKUP.radius + 3);
      g.fillStyle(color, 1);
      switch (pk.kind) {
        case 0:
          g.fillRect(pk.x - 3.5, y - 11, 7, 22);
          g.fillRect(pk.x - 11, y - 3.5, 22, 7);
          break;
        case 1:
          g.fillRect(pk.x - 10, y + 2, 20, 5);
          for (const a of [-0.45, 0, 0.45]) g.fillCircle(pk.x + Math.sin(a) * 9, y - 5 - Math.cos(a) * 5, 2.5);
          break;
        case 2:
          g.fillRect(pk.x - 12, y - 2.5, 24, 5);
          g.fillStyle(0xffffff, 0.9);
          g.fillRect(pk.x - 8, y - 1, 16, 2);
          break;
        case 3:
          g.fillTriangle(pk.x - 10, y - 8, pk.x - 10, y + 8, pk.x - 1, y);
          g.fillTriangle(pk.x, y - 8, pk.x, y + 8, pk.x + 9, y);
          break;
      }
    }
  }

  // 방을 만든 쪽이 초당 60틱을 못 돌리면 시뮬레이션이 실시간보다 느려진다. 그러면 참가한 쪽의 입력이
  // 호스트 큐에서 버려지고 화면이 계속 제자리로 되돌아간다. 게스트가 고칠 수 있는 문제가 아니므로
  // 양쪽에 원인을 알려 호스트를 바꾸도록 안내한다.
  private checkSlowHost(deltaMs: number): void {
    const now = performance.now();
    let slow: boolean;
    if (this.sync.kind === 'guest') {
      slow = (this.sync as GuestSync).hostTickRate < 45; // 참가한 쪽: 스냅샷으로 잰 호스트 속도
    } else {
      // 프레임 간격이 100ms를 넘으면 누적기 상한에 걸려 시뮬레이션이 뒤처진다
      if (deltaMs > 100) this.slowFrames += 1;
      else this.slowFrames = Math.max(0, this.slowFrames - 1);
      slow = this.slowFrames > 10;
    }
    if (!slow) {
      this.slowSince = 0;
      this.slowWarn.setText('');
      return;
    }
    if (this.slowSince === 0) this.slowSince = now;
    // 잠깐 튄 것으로 경고가 번쩍이지 않게 1초 이상 이어질 때만 띄운다
    if (now - this.slowSince < 1000) return;
    this.slowWarn.setText(
      this.sync.kind === 'guest'
        ? '방을 만든 기기가 따라오지 못해 경기가 느립니다 · 그 기기에서 다른 창을 앞으로 두지 마세요'
        : '이 기기가 초당 60틱을 못 돌려 경기가 느립니다 · 다른 창을 앞으로 두지 마세요',
    );
  }

  // 0.5초마다 진단값을 기록해 둔다. 경기가 끝난 뒤 파일로 내보내 원인을 따질 때 쓴다.
  private sampleRecord(): void {
    this.recordTick += 1;
    if (this.recordTick % SAMPLE_INTERVAL_TICKS !== 0) return;
    const rs = this.sync.renderState(performance.now());
    const info = this.sync.debugInfo();
    // 진단 줄(debugInfo)에서 '이름 숫자'를 뽑는다. 동기화 구현마다 가진 값이 달라 문자열로 주고받는다
    const num = (key: string): number | undefined => {
      const m = new RegExp(key + ' (-?[\d.]+)').exec(info);
      return m ? Number(m[1]) : undefined;
    };
    this.recorder.sample({
      t: this.recordTick,
      rtt: this.session?.rtt ?? 0,
      hostRate: this.sync.kind === 'guest' ? (this.sync as GuestSync).hostTickRate : undefined,
      pend: num('pending'),
      q: num('queue'),
      drop: num('drop'),
      smooth: num('smooth'),
      snapped: num('snapped'),
      hp: [rs.players[0].hp, rs.players[1].hp],
      ch: [rs.players[0].character, rs.players[1].character],
      wave: rs.coop?.wave,
      core: rs.coop?.coreHp,
      enemies: rs.coop?.enemies.length,
      mv: [Math.round(this.lastMove[0] * 100) / 100, Math.round(this.lastMove[1] * 100) / 100],
      input: this.desktop.active ? (this.desktop.hasFocus ? 'kb' : 'kb-nofocus') : 'touch',
    });
  }

  // HUD는 항상 내 줄을 맨 위에 둔다. 슬롯 번호로 배치하면 방을 만든 쪽과 참가한 쪽에서
  // 내 바의 위치가 뒤바뀌어, 상대 체력이 줄어드는 것을 내 것으로 읽게 된다.
  private hudSlot(id: 0 | 1): 0 | 1 {
    return id === this.sync.localId ? 0 : 1;
  }

  // 초상 오른쪽의 HP 바. 픽업 무기·부스트가 걸려 있으면 바 아래 얇은 띠로 표시한다.
  private renderHealthBars(rs: RenderState): void {
    const g = this.hudGfx;
    g.clear();
    this.hudMe.setVisible(rs.playerCount === 2);
    const hl = this.hudL;
    const k = hl.s;
    const x = hl.barX;
    const w = hl.barW;
    for (const p of rs.players) {
      if (p.id >= rs.playerCount) continue;
      const character = CHARACTERS[p.character];
      const y = hl.rowY(this.hudSlot(p.id));
      const ratio = Math.max(0, p.hp / character.stats.maxHp);
      g.fillStyle(0x05080f, 0.75);
      g.fillRoundedRect(x - 2 * k, y - 9 * k, w + 4 * k, 18 * k, 4 * k);
      g.fillStyle(0x1b2540, 1);
      g.fillRect(x, y - 6 * k, w, 12 * k);
      g.fillStyle(p.id === this.sync.localId ? character.color : 0xff6b6b, 1); // 내 바는 내 고유색, 상대·짝은 빨강
      g.fillRect(x, y - 6 * k, w * ratio, 12 * k);
      if (p.weaponTicks > 0) {
        g.fillStyle(WEAPONS[p.weapon].color, 1);
        g.fillRect(x, y + 7 * k, w * (p.weaponTicks / WEAPONS[p.weapon].durationTicks), 3 * k);
      }
      if (p.boostTicks > 0) {
        g.fillStyle(PICKUP_COLORS[3], 1);
        g.fillRect(x, y + 11 * k, w * (p.boostTicks / PICKUP.boostTicks), 3 * k);
      }
    }
  }

  private renderHudPortraits(rs: RenderState): void {
    for (const p of rs.players) {
      const slot = this.hudSlot(p.id);
      const wanted = p.id < rs.playerCount ? p.character : null;
      if (this.hudPortraitIds[slot] !== wanted) {
        // 파티마가 바뀌었을 때만 카드를 새로 만든다 (매 프레임 만들면 느리다)
        this.hudPortraits[slot]?.destroy();
        this.hudPortraits[slot] = wanted
          ? addPortraitCard(this, wanted, this.hudL.cardX, this.hudL.rowY(slot), this.hudL.cardW, this.hudL.cardH, CHARACTERS[wanted].color, 2)?.setDepth(50) ??
            null
          : null;
        this.hudPortraitIds[slot] = wanted;
      }
      this.hudPortraits[slot]?.setAlpha(p.hp > 0 ? 1 : 0.35); // 다운되면 흐리게
    }
  }

  private renderHud(rs: RenderState): void {
    this.renderHudPortraits(rs);
    this.renderHealthBars(rs);
    const me = rs.players[this.sync.localId];
    this.weaponButton.setText(`무기 ▸ ${WEAPONS[me.baseWeapon].name}`);

    if (this.hud) {
      const net = this.session
        ? `RTT ${this.session.rtt.toFixed(0)}ms ${this.session.kind}/${this.sync.kind} ${this.sync.debugInfo()}`
        : '';
      this.hud.setText(`tick ${rs.tick} ${net}`);
    }

    if (rs.mode === 'coop' && rs.coop) {
      const c = rs.coop;
      this.banner.setText(
        c.phase === 0
          ? `WAVE ${c.wave + 1} 준비 — ${Math.ceil(c.timer / SIM.tickRate)}s   코어 ${c.coreHp}` // 휴식 중: 다음 웨이브까지 남은 초
          : `WAVE ${c.wave}/${COOP.waves}   적 ${c.enemies.length}   코어 ${c.coreHp}`,
      );
    } else {
      this.banner.setText('');
    }
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.worldScale = Math.min(width / SIM.arenaW, height / SIM.arenaH); // 경기장 전체가 화면에 들어가는 최대 배율
    this.baseX = (width - SIM.arenaW * this.worldScale) / 2; // 남는 여백을 양쪽에 나눠 가운데 정렬
    this.baseY = (height - SIM.arenaH * this.worldScale) / 2;
    this.world.setScale(this.worldScale);
    this.world.setPosition(this.baseX, this.baseY);
    this.banner.setX(width / 2);
    this.slowWarn.setX(width / 2);
    this.focusWarn.setPosition(width / 2, height - px(this, 40));
    // 오른쪽 버튼은 화면 가장자리를 따라간다 (창 크기 변경·화면 회전)
    const u = (n: number) => px(this, n);
    this.dashButton.setPosition(width - u(90), height * 0.35);
    this.weaponButton.setPosition(width - u(90), height * 0.5);
    this.exitButton.setPosition(width - u(60), u(30));
    this.waveText.setPosition(width / 2, height / 2);
    this.reconnectShade.setSize(width, height);
    this.reconnectText.setPosition(width / 2, height / 2);
  }

  // ✕ 버튼: 경기를 버리고 타이틀로 (둘이면 연결도 끊는다)
  private exit(): void {
    this.ended = true;
    this.session?.close();
    this.scene.start('Title');
  }

  private cleanup(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLock?.release();
    this.wakeLock = null;
    this.scale.off('resize', this.layout, this);
    this.moveStick.destroy();
    this.aimStick.destroy();
    this.desktop.destroy();
  }
}
