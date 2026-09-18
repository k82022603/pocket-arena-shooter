import Phaser from 'phaser';
import { CHARACTERS } from '../../sim/characters';
import { SIM, type InputFrame, type PlayerState } from '../../sim/types';
import type { Session } from '../../net/connect';
import type { Unsubscribe } from '../../net/transport';
import { VirtualStick } from '../input/VirtualStick';
import { FONT, makeButton } from '../ui';
import type { GameSync } from '../sync/GameSync';
import { SoloSync } from '../sync/SoloSync';
import { HostSync } from '../sync/HostSync';
import { GuestSync } from '../sync/GuestSync';
import { selectedCharacter } from './TitleScene';

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
  private moveStick!: VirtualStick;
  private aimStick!: VirtualStick;
  private dashPressed = false;

  constructor() {
    super('Arena');
  }

  create(data: ArenaData): void {
    const local = selectedCharacter(this);
    this.accumulator = 0;
    this.unsubscribes = [];

    if (data.mode === 'versus') {
      this.session = data.session;
      const transport = data.session.transport;
      this.sync = data.session.role === 'host' ? new HostSync(transport, local) : new GuestSync(transport, local);
      this.unsubscribes.push(transport.onMessage((channel, bytes) => this.sync.handleMessage(channel, bytes)));
      this.unsubscribes.push(transport.onClose(() => this.scene.start('Title')));
    } else {
      this.session = undefined;
      this.sync = new SoloSync(local);
    }

    this.world = this.add.container(0, 0);
    this.gfx = this.add.graphics();
    this.world.add(this.gfx);
    this.nameLabels = [this.makeNameLabel(), this.makeNameLabel()];

    this.hud = this.add.text(12, 12, '', { fontFamily: FONT, fontSize: '18px', color: '#ffffff' }).setDepth(50);

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
      const winner = this.sync.winner();
      if (winner !== null) {
        this.scene.start('Result', { winner, localId: this.sync.localId, session: this.session });
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

    for (const p of rs.players) {
      const character = CHARACTERS[p.character];
      const alive = p.hp > 0;
      g.fillStyle(character.color, alive ? 1 : 0.3);
      g.fillCircle(p.x, p.y, SIM.playerRadius);
      if (p.dashTicks > 0) {
        g.lineStyle(2, 0xffffff, 0.6);
        g.strokeCircle(p.x, p.y, SIM.playerRadius + 6);
      }
      g.lineStyle(3, 0xffffff, 0.8);
      g.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(p.aimAngle) * SIM.playerRadius * 1.6,
        p.y + Math.sin(p.aimAngle) * SIM.playerRadius * 1.6,
      );
      const label = this.nameLabels[p.id];
      label.setPosition(p.x, p.y - SIM.playerRadius - 6).setAlpha(alive ? 1 : 0.4);
      label.setText(`${character.name}${p.id === this.sync.localId ? ' (나)' : ''}`);
    }

    g.fillStyle(0xffe066, 1);
    for (const b of rs.bullets) g.fillCircle(b.x, b.y, SIM.bulletRadius);

    const [p0, p1] = rs.players;
    const hp = (p: PlayerState) => `${CHARACTERS[p.character].name} ${p.hp}/${CHARACTERS[p.character].stats.maxHp}`;
    const net = this.session
      ? `\nRTT ${this.session.transport.rtt.toFixed(0)}ms  ${this.session.transport.kind}/${this.sync.kind}  ${this.sync.debugInfo()}`
      : '';
    this.hud.setText(`${hp(p0)}   vs   ${hp(p1)}   tick ${rs.tick}${net}`);
  }

  private layout(): void {
    const { width, height } = this.scale;
    const scale = Math.min(width / SIM.arenaW, height / SIM.arenaH);
    this.world.setScale(scale);
    this.world.setPosition((width - SIM.arenaW * scale) / 2, (height - SIM.arenaH * scale) / 2);
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
