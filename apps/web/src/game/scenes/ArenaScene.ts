import Phaser from 'phaser';
import { CHARACTERS } from '../../sim/characters';
import { COOP, ENEMIES, ENEMY_OWNER, SIM, type InputFrame, type PlayerState } from '../../sim/types';
import type { Session } from '../../net/connect';
import type { Unsubscribe } from '../../net/transport';
import { VirtualStick } from '../input/VirtualStick';
import { FONT, makeButton } from '../ui';
import type { GameSync, RenderState } from '../sync/GameSync';
import { SoloSync } from '../sync/SoloSync';
import { HostSync } from '../sync/HostSync';
import { GuestSync } from '../sync/GuestSync';
import { selectedCharacter, selectedMode } from './TitleScene';

type ArenaData = { mode: 'solo' } | { mode: 'versus'; session: Session };

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
  private moveStick!: VirtualStick;
  private aimStick!: VirtualStick;
  private dashPressed = false;

  constructor() {
    super('Arena');
  }

  create(data: ArenaData): void {
    const local = selectedCharacter(this);
    const mode = selectedMode(this);
    this.accumulator = 0;
    this.unsubscribes = [];

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

  private render(): void {
    const rs = this.sync.renderState(performance.now());
    const g = this.gfx;
    g.clear();

    g.lineStyle(2, 0x2a3552, 1);
    g.strokeRect(0, 0, SIM.arenaW, SIM.arenaH);

    if (rs.mode === 'coop' && rs.coop) this.renderCoop(rs);

    for (const p of rs.players) {
      const label = this.nameLabels[p.id];
      if (p.id >= rs.playerCount) {
        label.setVisible(false);
        continue;
      }
      label.setVisible(true);
      this.renderPlayer(p, rs);
    }

    for (const b of rs.bullets) {
      g.fillStyle(b.owner === ENEMY_OWNER ? 0xff7043 : 0xffe066, 1);
      g.fillCircle(b.x, b.y, SIM.bulletRadius);
    }

    this.renderHud(rs);
  }

  private renderPlayer(p: PlayerState, rs: RenderState): void {
    const g = this.gfx;
    const character = CHARACTERS[p.character];
    const alive = p.hp > 0;
    g.fillStyle(character.color, alive ? 1 : 0.3);
    g.fillCircle(p.x, p.y, SIM.playerRadius);
    if (p.dashTicks > 0) {
      g.lineStyle(2, 0xffffff, 0.6);
      g.strokeCircle(p.x, p.y, SIM.playerRadius + 6);
    }
    if (alive) {
      g.lineStyle(3, 0xffffff, 0.8);
      g.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(p.aimAngle) * SIM.playerRadius * 1.6,
        p.y + Math.sin(p.aimAngle) * SIM.playerRadius * 1.6,
      );
    } else if (rs.mode === 'coop') {
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

  private renderCoop(rs: RenderState): void {
    const g = this.gfx;
    const coop = rs.coop!;

    const coreRatio = coop.coreHp / COOP.coreMaxHp;
    g.fillStyle(0x1e3a5f, 1);
    g.fillCircle(COOP.coreX, COOP.coreY, COOP.coreRadius);
    g.lineStyle(4, coreRatio > 0.3 ? 0x4cc9f0 : 0xff5252, 1);
    g.strokeCircle(COOP.coreX, COOP.coreY, COOP.coreRadius);
    g.fillStyle(0x000000, 0.5);
    g.fillRect(COOP.coreX - 50, COOP.coreY + COOP.coreRadius + 8, 100, 8);
    g.fillStyle(0x4cc9f0, 1);
    g.fillRect(COOP.coreX - 50, COOP.coreY + COOP.coreRadius + 8, 100 * coreRatio, 8);

    for (const pk of coop.pickups) {
      g.fillStyle(0x69f0ae, 1);
      g.fillRect(pk.x - 4, pk.y - 12, 8, 24);
      g.fillRect(pk.x - 12, pk.y - 4, 24, 8);
    }

    for (const e of coop.enemies) {
      const spec = ENEMIES[e.kind];
      g.fillStyle(spec.color, 1);
      if (e.kind === 1) g.fillRect(e.x - spec.radius, e.y - spec.radius, spec.radius * 2, spec.radius * 2);
      else g.fillCircle(e.x, e.y, spec.radius);
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
    const scale = Math.min(width / SIM.arenaW, height / SIM.arenaH);
    this.world.setScale(scale);
    this.world.setPosition((width - SIM.arenaW * scale) / 2, (height - SIM.arenaH * scale) / 2);
    this.banner.setX(width / 2);
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
