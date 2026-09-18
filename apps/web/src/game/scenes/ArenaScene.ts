import Phaser from 'phaser';
import { CHARACTERS } from '../../sim/characters';
import { COOP, ENEMIES, ENEMY_OWNER, SIM, type BulletState, type InputFrame, type PlayerState } from '../../sim/types';
import { PICKUP, PICKUP_COLORS, WEAPONS } from '../../sim/weapons';
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
import { FONT, makeButton } from '../ui';
import type { GameSync, RenderState } from '../sync/GameSync';
import { SoloSync } from '../sync/SoloSync';
import { HostSync } from '../sync/HostSync';
import { GuestSync } from '../sync/GuestSync';
import { selectedCharacter, selectedMode } from './TitleScene';
import { selectedLoadout } from '../loadout';

type ArenaData = { mode: 'solo' } | { mode: 'versus'; session: Session };

const ENEMY_BULLET_COLOR = 0xff7043;
const PLAYER_BULLET_COLOR = 0xffe066;
const FLASH_MS = 90;

interface BulletMemo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  color: number;
}

interface EnemyMemo {
  x: number;
  y: number;
  hp: number;
  kind: 0 | 1 | 2;
}

export class ArenaScene extends Phaser.Scene {
  private sync!: GameSync;
  private session?: Session;
  private unsubscribes: Unsubscribe[] = [];
  private accumulator = 0;

  private world!: Phaser.GameObjects.Container;
  private gfx!: Phaser.GameObjects.Graphics;
  private nameLabels!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private hudPortraits: [Phaser.GameObjects.Container | null, Phaser.GameObjects.Container | null] = [null, null];
  private hudPortraitIds: [CharacterId | null, CharacterId | null] = [null, null];
  private reconnectShade!: Phaser.GameObjects.Rectangle;
  private reconnectText!: Phaser.GameObjects.Text;
  private ended = false;
  private moveStick!: VirtualStick;
  private aimStick!: VirtualStick;
  private desktop!: DesktopControls;
  private lastRender: RenderState | null = null;
  private dashPressed = false;

  private readonly fx = new Fx();
  private worldScale = 1;
  private baseX = 0;
  private baseY = 0;
  private seen = false;
  private prevBullets = new Map<number, BulletMemo>();
  private prevEnemies = new Map<number, EnemyMemo>();
  private prevPickups = new Set<number>();
  private prevHp: [number, number] = [0, 0];
  private prevDash: [number, number] = [0, 0];
  private prevWeapon: [number, number] = [0, 0];
  private prevBoost: [number, number] = [0, 0];
  private prevPos: [{ x: number; y: number } | null, { x: number; y: number } | null] = [null, null];
  private trail: [{ x: number; y: number }, { x: number; y: number }] = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  private prevCoreHp = 0;
  private prevPhase = -1;
  private readonly flashUntil = new Map<string, number>();
  private wakeLock: WakeLockSentinel | null = null;
  private perfSamples = 0;
  private perfElapsed = 0;
  private perfDecided = false;

  constructor() {
    super('Arena');
  }

  private async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
    } catch {
      this.wakeLock = null;
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.acquireWakeLock();
  };

  // 처음 3초 동안 프레임 시간을 재서 느리면 파티클을 줄인다.
  private samplePerformance(deltaMs: number): void {
    if (this.perfDecided) return;
    this.perfSamples += 1;
    this.perfElapsed += deltaMs;
    if (this.perfElapsed < 3000) return;
    this.perfDecided = true;
    const fps = (this.perfSamples * 1000) / this.perfElapsed;
    const lowMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
    this.fx.quality = fps < 40 ? 0.35 : fps < 52 || lowMemory <= 2 ? 0.6 : 1;
  }

  create(data: ArenaData): void {
    const local = selectedCharacter(this);
    const mode = selectedMode(this);
    const weapon = selectedLoadout(this, local);
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
      this.sync = new SoloSync(local, mode, weapon);
    }

    this.world = this.add.container(0, 0);
    this.gfx = this.add.graphics();
    this.world.add(this.gfx);
    this.nameLabels = [this.makeNameLabel(), this.makeNameLabel()];

    this.hud = this.add.text(60, 12, '', { fontFamily: FONT, fontSize: '18px', color: '#ffffff' }).setDepth(50);
    this.hudPortraits = [null, null];
    this.hudPortraitIds = [null, null];
    this.banner = this.add
      .text(this.scale.width / 2, 58, '', { fontFamily: FONT, fontSize: '22px', color: '#ffe066' })
      .setOrigin(0.5, 0)
      .setDepth(50);
    this.waveText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontFamily: FONT,
        fontSize: '64px',
        color: '#ffe066',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setAlpha(0);
    this.reconnectShade = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x05080f, 0.6)
      .setOrigin(0)
      .setDepth(70)
      .setVisible(false);
    this.reconnectText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', { fontFamily: FONT, fontSize: '26px', color: '#ffffff', align: 'center' })
      .setOrigin(0.5)
      .setDepth(71)
      .setVisible(false);

    // 스틱보다 먼저 등록해야 같은 포인터 이벤트에서 스틱이 마우스를 잡기 전에 터치 전용으로 전환된다.
    this.desktop = new DesktopControls(this, (active) => {
      this.moveStick.touchOnly = active;
      this.aimStick.touchOnly = active;
    });
    this.moveStick = new VirtualStick(this, 'left');
    this.aimStick = new VirtualStick(this, 'right');
    this.moveStick.touchOnly = this.desktop.active;
    this.aimStick.touchOnly = this.desktop.active;
    this.lastRender = null;

    const dash = makeButton(this, this.scale.width - 90, this.scale.height * 0.35, 'DASH', () => {});
    dash.setDepth(102);
    dash.on('pointerdown', () => (this.dashPressed = true));

    makeButton(this, this.scale.width - 60, 30, '✕', () => this.exit()).setDepth(102).setFontSize(18);

    this.scale.on('resize', this.layout, this);
    this.layout();
    this.events.once('shutdown', this.cleanup, this);

    this.perfSamples = 0;
    this.perfElapsed = 0;
    this.perfDecided = false;
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

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
    this.hideReconnectOverlay();
    this.accumulator += Math.min(deltaMs, 100) / 1000;
    while (this.accumulator >= SIM.dt) {
      this.accumulator -= SIM.dt;
      this.sync.step(this.readLocalInput());
      const outcome = this.sync.outcome();
      if (outcome !== null) {
        this.finish(outcome);
        return;
      }
    }
    this.fx.update(deltaMs);
    this.render();
  }

  private finish(outcome: Outcome, note?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.scene.start('Result', {
      outcome,
      summary: this.sync.summary(),
      localId: this.sync.localId,
      session: this.session,
      note,
    });
  }

  // 복구 실패: 상대가 떠났으면(peer_left) 내가 남은 쪽, 내 재접속이 실패했으면 내가 떨어진 쪽이다.
  private endByDisconnect(reason: FailReason): void {
    const rs = this.sync.renderState(performance.now());
    const remaining = reason === 'peer_left';
    const localId = this.sync.localId;
    const outcome: Outcome =
      rs.mode === 'coop'
        ? { mode: 'coop', won: false, wave: rs.coop?.wave ?? 0 }
        : { mode: 'duel', winner: remaining ? localId : localId === 0 ? 1 : 0 };
    this.finish(outcome, remaining ? '상대의 연결이 끊겼습니다' : '연결을 복구하지 못했습니다');
  }

  private renderReconnectOverlay(): void {
    const remain = Math.max(0, Math.ceil((this.session!.deadline - performance.now()) / 1000));
    this.reconnectShade.setVisible(true);
    this.reconnectText.setVisible(true).setText(`재연결 중… (${remain})\n연결이 복구되면 그 시점부터 이어집니다`);
  }

  private hideReconnectOverlay(): void {
    if (!this.reconnectShade.visible) return;
    this.reconnectShade.setVisible(false);
    this.reconnectText.setVisible(false);
  }

  private makeNameLabel(): Phaser.GameObjects.Text {
    const label = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5, 1);
    this.world.add(label);
    return label;
  }

  private readLocalInput(): InputFrame {
    const move = this.moveStick.vector;
    const aim = this.aimStick.vector;
    const frame: InputFrame = {
      moveX: move.x,
      moveY: move.y,
      aimX: aim.x,
      aimY: aim.y,
      fire: aim.magnitude > 0.3,
      dash: this.dashPressed,
      skill: false,
    };
    this.dashPressed = false;

    const me = this.lastRender?.players[this.sync.localId];
    const desk = me ? this.desktop.read(this.baseX + me.x * this.worldScale, this.baseY + me.y * this.worldScale) : null;
    if (desk) {
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
    }
    return frame;
  }

  // 렌더 상태를 프레임 간 비교해 연출 이벤트를 만든다. 솔로/호스트/게스트 모두 같은 경로를 탄다.
  private detectEvents(rs: RenderState, now: number): void {
    const first = !this.seen;
    this.seen = true;

    const bullets = new Map<number, BulletMemo>();
    for (const b of rs.bullets) {
      const color = this.bulletColor(b, rs);
      bullets.set(b.id, { x: b.x, y: b.y, vx: b.vx, vy: b.vy, ttl: b.ttl, color });
      if (!first && !this.prevBullets.has(b.id)) {
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
          this.flashUntil.set(`p${p.id}`, now + FLASH_MS);
          this.fx.burst(p.x, p.y, 0xff5252, 8, 180, 260, 2.5);
          if (p.hp <= 0) {
            this.fx.burst(p.x, p.y, color, 36, 340, 700, 4, 0.94);
            this.fx.ring(p.x, p.y, color, 110, 500, 5);
            this.fx.shake(8, 320);
            sfx.down();
          } else {
            this.fx.ring(p.x, p.y, 0xff5252, 40, 220, 2);
            this.fx.shake(p.id === this.sync.localId ? 3 : 1.5, 110);
            if (p.id === this.sync.localId) sfx.hurt();
          }
        } else if (p.hp > prevHp && prevHp > 0) {
          this.fx.burst(p.x, p.y, 0x69f0ae, 12, 120, 400, 2.5);
          sfx.pickup();
        } else if (p.hp > 0 && prevHp <= 0) {
          this.fx.ring(p.x, p.y, 0x69f0ae, 90, 500, 4);
          this.fx.burst(p.x, p.y, 0x69f0ae, 24, 200, 500, 3);
          sfx.revive();
        }
        if (p.hp > 0 && p.dashTicks > 0 && this.prevDash[p.id] === 0) sfx.dash();
        if (p.weapon !== this.prevWeapon[p.id] && p.weaponTicks > 0) {
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
        if (rs.pickups.some((pk) => pk.id === id)) continue;
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
        if (!first && !prev) this.fx.ring(e.x, e.y, ENEMIES[e.kind].color, ENEMIES[e.kind].radius + 22, 350, 2);
        if (prev && e.hp < prev.hp) this.flashUntil.set(`e${e.id}`, now + FLASH_MS);
      }
      if (!first) {
        for (const [id, prev] of this.prevEnemies) {
          if (enemies.has(id)) continue;
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
          this.showWaveText(`WAVE ${coop.wave}`);
          sfx.wave();
        }
        if (coop.phase === 0 && this.prevPhase === 2) {
          this.showWaveText('WAVE CLEAR');
          sfx.revive();
        }
      }
      this.prevEnemies = enemies;
      this.prevCoreHp = coop.coreHp;
      this.prevPhase = coop.phase;
    }
  }

  private bulletColor(b: BulletState, rs: RenderState): number {
    if (b.owner === ENEMY_OWNER) return ENEMY_BULLET_COLOR;
    if (b.kind !== 0) return WEAPONS[b.kind].color;
    return rs.mode === 'coop' ? CHARACTERS[rs.players[b.owner].character].color : PLAYER_BULLET_COLOR;
  }

  private showWaveText(text: string): void {
    this.tweens.killTweensOf(this.waveText);
    this.waveText.setText(text).setAlpha(1).setScale(1.8);
    this.tweens.add({ targets: this.waveText, scale: 1, duration: 320, ease: 'Back.Out' });
    this.tweens.add({ targets: this.waveText, alpha: 0, delay: 1100, duration: 400 });
  }

  private flashing(key: string, now: number): boolean {
    const until = this.flashUntil.get(key);
    return until !== undefined && until > now;
  }

  private render(): void {
    const now = performance.now();
    const rs = this.sync.renderState(now);
    this.lastRender = rs;
    this.detectEvents(rs, now);

    const shake = this.fx.shakeOffset();
    this.world.setPosition(this.baseX + shake.x * this.worldScale, this.baseY + shake.y * this.worldScale);

    const g = this.gfx;
    g.clear();
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
      const laser = b.kind === 2 || b.kind === 4;
      const trail = laser ? 5 : b.kind === 1 || b.kind === 5 ? 2 : 3;
      const tx = b.x - b.vx * SIM.dt * trail;
      const ty = b.y - b.vy * SIM.dt * trail;
      g.lineStyle(laser ? 12 : 7, color, laser ? 0.25 : 0.18);
      g.lineBetween(tx, ty, b.x, b.y);
      g.lineStyle(laser ? 4 : 2.5, color, 0.85);
      g.lineBetween(tx, ty, b.x, b.y);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(b.x, b.y, b.kind === 1 || b.kind === 5 || b.kind === 3 ? SIM.bulletRadius - 2 : SIM.bulletRadius - 1);
    }

    if (this.desktop.active) this.renderAimGuide(rs, now);
    this.fx.drawFront(g);
    this.renderHud(rs);
  }

  // PC 조작: 내 캐릭터에서 커서까지 점선 가이드와 커서 위치의 레티클을 그린다.
  private renderAimGuide(rs: RenderState, now: number): void {
    const me = rs.players[this.sync.localId];
    if (me.hp <= 0) return;
    const pointer = this.input.activePointer;
    const mx = (pointer.x - this.baseX) / this.worldScale;
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
    const r = (firing ? 13 : 10) + Math.sin(now / 120) * (firing ? 1.5 : 0.5);
    g.lineStyle(2, color, 0.9);
    g.strokeCircle(mx, my, r);
    g.lineStyle(2, color, 0.9);
    for (const [ax, ay] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      g.lineBetween(mx + ax * (r + 3), my + ay * (r + 3), mx + ax * (r + 9), my + ay * (r + 9));
    }
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(mx, my, 1.6);
  }

  private renderBackground(now: number): void {
    const g = this.gfx;
    g.lineStyle(1, 0x3a4a72, 0.12);
    for (let x = 80; x < SIM.arenaW; x += 80) g.lineBetween(x, 0, x, SIM.arenaH);
    for (let y = 80; y < SIM.arenaH; y += 80) g.lineBetween(0, y, SIM.arenaW, y);
    const pulse = 0.35 + 0.15 * Math.sin(now / 600);
    g.lineStyle(10, 0x4cc9f0, pulse * 0.25);
    g.strokeRect(0, 0, SIM.arenaW, SIM.arenaH);
    g.lineStyle(2, 0x4cc9f0, pulse);
    g.strokeRect(0, 0, SIM.arenaW, SIM.arenaH);
  }

  // 머리카락은 조준 반대 방향을 기본으로, 움직일 때는 이동 반대 방향으로 부드럽게 기운다.
  private updateTrail(p: PlayerState): { x: number; y: number } {
    const prev = this.prevPos[p.id];
    let dx = -Math.cos(p.aimAngle);
    let dy = -Math.sin(p.aimAngle);
    if (prev) {
      const vx = p.x - prev.x;
      const vy = p.y - prev.y;
      const speed = Math.hypot(vx, vy);
      if (speed > 0.8) {
        const w = Math.min(1, speed / 6);
        dx = dx * (1 - w) - (vx / speed) * w;
        dy = dy * (1 - w) - (vy / speed) * w;
      }
    }
    this.prevPos[p.id] = { x: p.x, y: p.y };
    const cur = this.trail[p.id];
    cur.x += (dx - cur.x) * 0.15;
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
      g.fillStyle(character.color, 0.12);
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
      g.lineStyle(2, 0xffffff, 0.7);
      g.strokeCircle(p.x, p.y, SIM.playerRadius + 8);
    }
    if (!alive && rs.mode === 'coop') {
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
    const coreColor = coreRatio > 0.3 ? 0x4cc9f0 : 0xff5252;
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
      if (e.kind === 1) g.fillRect(e.x - spec.radius, e.y - spec.radius, spec.radius * 2, spec.radius * 2);
      else g.fillCircle(e.x, e.y, spec.radius);
      if (e.kind === 2) {
        g.lineStyle(3, 0x000000, 0.35);
        g.strokeCircle(e.x, e.y, spec.radius * 0.55);
      }
      if (e.hp < spec.hp) {
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
      const bob = Math.sin(now / 250 + pk.id) * 3;
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

  private renderHudPortraits(rs: RenderState): void {
    for (const p of rs.players) {
      const slot = p.id;
      const wanted = p.id < rs.playerCount ? p.character : null;
      if (this.hudPortraitIds[slot] !== wanted) {
        this.hudPortraits[slot]?.destroy();
        this.hudPortraits[slot] = wanted
          ? addPortraitCard(this, wanted, 32, 34 + slot * 46, 40, 44, CHARACTERS[wanted].color, 2)?.setDepth(50) ?? null
          : null;
        this.hudPortraitIds[slot] = wanted;
      }
      this.hudPortraits[slot]?.setAlpha(p.hp > 0 ? 1 : 0.35);
    }
  }

  private renderHud(rs: RenderState): void {
    this.renderHudPortraits(rs);
    const [p0, p1] = rs.players;
    const hp = (p: PlayerState) => {
      let text = `${CHARACTERS[p.character].name} ${p.hp}/${CHARACTERS[p.character].stats.maxHp}`;
      if (p.weaponTicks > 0) text += ` [${WEAPONS[p.weapon].name} ${Math.ceil(p.weaponTicks / SIM.tickRate)}s]`;
      else if (p.weapon !== 0) text += ` [${WEAPONS[p.weapon].name}]`;
      if (p.boostTicks > 0) text += ` [부스트 ${Math.ceil(p.boostTicks / SIM.tickRate)}s]`;
      return text;
    };
    const players = rs.playerCount === 2 ? `${hp(p0)}   vs   ${hp(p1)}` : hp(p0);
    const net = this.session
      ? `\nRTT ${this.session.rtt.toFixed(0)}ms  ${this.session.kind}/${this.sync.kind}  ${this.sync.debugInfo()}`
      : '';
    this.hud.setText(`${players}   tick ${rs.tick}${net}`);

    if (rs.mode === 'coop' && rs.coop) {
      const c = rs.coop;
      this.banner.setText(
        c.phase === 0
          ? `WAVE ${c.wave + 1} 준비 — ${Math.ceil(c.timer / SIM.tickRate)}s   코어 ${c.coreHp}`
          : `WAVE ${c.wave}/${COOP.waves}   적 ${c.enemies.length}   코어 ${c.coreHp}`,
      );
    } else {
      this.banner.setText('');
    }
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.worldScale = Math.min(width / SIM.arenaW, height / SIM.arenaH);
    this.baseX = (width - SIM.arenaW * this.worldScale) / 2;
    this.baseY = (height - SIM.arenaH * this.worldScale) / 2;
    this.world.setScale(this.worldScale);
    this.world.setPosition(this.baseX, this.baseY);
    this.banner.setX(width / 2);
    this.waveText.setPosition(width / 2, height / 2);
    this.reconnectShade.setSize(width, height);
    this.reconnectText.setPosition(width / 2, height / 2);
  }

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
