import Phaser from 'phaser';
import { CHARACTERS } from '../../sim/characters';
import { COOP, ENEMIES, ENEMY_OWNER, SIM, type BulletState, type InputFrame, type PlayerState } from '../../sim/types';
import type { Session } from '../../net/connect';
import type { Unsubscribe } from '../../net/transport';
import { VirtualStick } from '../input/VirtualStick';
import { Fx } from '../fx/Fx';
import { LOOKS, drawFatima } from '../fx/Fatima';
import { FONT, makeButton } from '../ui';
import type { GameSync, RenderState } from '../sync/GameSync';
import { SoloSync } from '../sync/SoloSync';
import { HostSync } from '../sync/HostSync';
import { GuestSync } from '../sync/GuestSync';
import { selectedCharacter, selectedMode } from './TitleScene';

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
  private moveStick!: VirtualStick;
  private aimStick!: VirtualStick;
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
  private prevPos: [{ x: number; y: number } | null, { x: number; y: number } | null] = [null, null];
  private trail: [{ x: number; y: number }, { x: number; y: number }] = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  private prevCoreHp = 0;
  private prevPhase = -1;
  private readonly flashUntil = new Map<string, number>();

  constructor() {
    super('Arena');
  }

  create(data: ArenaData): void {
    const local = selectedCharacter(this);
    const mode = selectedMode(this);
    this.accumulator = 0;
    this.unsubscribes = [];
    this.seen = false;
    this.prevBullets.clear();
    this.prevEnemies.clear();
    this.prevPickups.clear();
    this.flashUntil.clear();
    this.prevPos = [null, null];

    if (data.mode === 'versus') {
      this.session = data.session;
      const transport = data.session.transport;
      this.sync = data.session.role === 'host' ? new HostSync(transport, local, mode) : new GuestSync(transport, local);
      this.unsubscribes.push(transport.onMessage((channel, bytes) => this.sync.handleMessage(channel, bytes)));
      this.unsubscribes.push(transport.onClose(() => this.scene.start('Title')));
    } else {
      this.session = undefined;
      this.sync = new SoloSync(local, mode);
    }

    this.world = this.add.container(0, 0);
    this.gfx = this.add.graphics();
    this.world.add(this.gfx);
    this.nameLabels = [this.makeNameLabel(), this.makeNameLabel()];

    this.hud = this.add.text(12, 12, '', { fontFamily: FONT, fontSize: '18px', color: '#ffffff' }).setDepth(50);
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

    this.moveStick = new VirtualStick(this, 'left');
    this.aimStick = new VirtualStick(this, 'right');

    const dash = makeButton(this, this.scale.width - 90, this.scale.height * 0.35, 'DASH', () => {});
    dash.setDepth(102);
    dash.on('pointerdown', () => (this.dashPressed = true));

    makeButton(this, this.scale.width - 60, 30, '✕', () => this.exit()).setDepth(102).setFontSize(18);

    this.scale.on('resize', this.layout, this);
    this.layout();
    this.events.once('shutdown', this.cleanup, this);
  }

  update(_time: number, deltaMs: number): void {
    this.accumulator += Math.min(deltaMs, 100) / 1000;
    while (this.accumulator >= SIM.dt) {
      this.accumulator -= SIM.dt;
      this.sync.step(this.readLocalInput());
      const outcome = this.sync.outcome();
      if (outcome !== null) {
        this.scene.start('Result', { outcome, localId: this.sync.localId, session: this.session });
        return;
      }
    }
    this.fx.update(deltaMs);
    this.render();
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
      }
    }
    if (!first) {
      for (const [id, b] of this.prevBullets) {
        if (bullets.has(id)) continue;
        const inside = b.x > 2 && b.y > 2 && b.x < SIM.arenaW - 2 && b.y < SIM.arenaH - 2;
        if (b.ttl > 2 && inside) this.fx.burst(b.x, b.y, b.color, 6, 200, 220, 2.5);
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
          } else {
            this.fx.ring(p.x, p.y, 0xff5252, 40, 220, 2);
            this.fx.shake(p.id === this.sync.localId ? 3 : 1.5, 110);
          }
        } else if (p.hp > prevHp && prevHp > 0) {
          this.fx.burst(p.x, p.y, 0x69f0ae, 12, 120, 400, 2.5);
        } else if (p.hp > 0 && prevHp <= 0) {
          this.fx.ring(p.x, p.y, 0x69f0ae, 90, 500, 4);
          this.fx.burst(p.x, p.y, 0x69f0ae, 24, 200, 500, 3);
        }
      }
      if (p.hp > 0 && p.dashTicks > 0) this.fx.ghost(p.x, p.y, SIM.playerRadius * 1.1, color);
      this.prevHp[p.id] = p.hp;
    }

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
        }
        for (const id of this.prevPickups) {
          if (coop.pickups.some((pk) => pk.id === id)) continue;
          for (const p of rs.players) {
            if (p.id < rs.playerCount && p.hp > 0) {
              this.fx.burst(p.x, p.y, 0x69f0ae, 10, 150, 400, 2.5);
              break;
            }
          }
        }
        if (coop.coreHp < this.prevCoreHp) {
          this.fx.ring(COOP.coreX, COOP.coreY, 0xff5252, COOP.coreRadius + 30, 300, 4);
          this.fx.shake(4, 160);
          this.flashUntil.set('core', now + FLASH_MS);
        }
        if (coop.phase === 1 && this.prevPhase === 0) this.showWaveText(`WAVE ${coop.wave}`);
        if (coop.phase === 0 && this.prevPhase === 2) this.showWaveText('WAVE CLEAR');
      }
      this.prevEnemies = enemies;
      this.prevPickups = new Set(coop.pickups.map((pk) => pk.id));
      this.prevCoreHp = coop.coreHp;
      this.prevPhase = coop.phase;
    }
  }

  private bulletColor(b: BulletState, rs: RenderState): number {
    if (b.owner === ENEMY_OWNER) return ENEMY_BULLET_COLOR;
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

    for (const b of rs.bullets) {
      const color = this.bulletColor(b, rs);
      const tx = b.x - b.vx * SIM.dt * 3;
      const ty = b.y - b.vy * SIM.dt * 3;
      g.lineStyle(7, color, 0.18);
      g.lineBetween(tx, ty, b.x, b.y);
      g.lineStyle(2.5, color, 0.85);
      g.lineBetween(tx, ty, b.x, b.y);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(b.x, b.y, SIM.bulletRadius - 1);
    }

    this.fx.drawFront(g);
    this.renderHud(rs);
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

    for (const pk of coop.pickups) {
      const bob = Math.sin(now / 250 + pk.id) * 3;
      g.fillStyle(0x69f0ae, 0.2);
      g.fillCircle(pk.x, pk.y + bob, COOP.pickupRadius + 6);
      g.fillStyle(0x69f0ae, 1);
      g.fillRect(pk.x - 4, pk.y - 12 + bob, 8, 24);
      g.fillRect(pk.x - 12, pk.y - 4 + bob, 24, 8);
    }

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

  private renderHud(rs: RenderState): void {
    const [p0, p1] = rs.players;
    const hp = (p: PlayerState) => `${CHARACTERS[p.character].name} ${p.hp}/${CHARACTERS[p.character].stats.maxHp}`;
    const players = rs.playerCount === 2 ? `${hp(p0)}   vs   ${hp(p1)}` : hp(p0);
    const net = this.session
      ? `\nRTT ${this.session.transport.rtt.toFixed(0)}ms  ${this.session.transport.kind}/${this.sync.kind}  ${this.sync.debugInfo()}`
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
  }

  private exit(): void {
    this.session?.transport.close();
    this.session?.signaling.close();
    this.scene.start('Title');
  }

  private cleanup(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.scale.off('resize', this.layout, this);
    this.moveStick.destroy();
    this.aimStick.destroy();
  }
}
