import Phaser from 'phaser';
import { CHARACTERS, characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import { createInitialState, setPlayerCharacter, step } from '../../sim/core';
import { decodeCharacter, decodeInput, encodeCharacter, encodeInput } from '../../sim/serialize';
import { EMPTY_INPUT, SIM, type InputFrame, type SimState } from '../../sim/types';
import type { Session } from '../../net/connect';
import { VirtualStick } from '../input/VirtualStick';
import { FONT, makeButton } from '../ui';
import { selectedCharacter } from './TitleScene';

type ArenaData = { mode: 'solo' } | { mode: 'versus'; session: Session };

export class ArenaScene extends Phaser.Scene {
  private state!: SimState;
  private accumulator = 0;
  private localId: 0 | 1 = 0;
  private remoteInput: InputFrame = { ...EMPTY_INPUT };
  private session?: Session;

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
    this.remoteInput = { ...EMPTY_INPUT };

    if (data.mode === 'versus') {
      this.session = data.session;
      this.localId = data.session.role === 'host' ? 0 : 1;
      const remoteId = this.localId === 0 ? 1 : 0;
      // 상대 캐릭터는 event 채널로 도착할 때까지 임시로 내 캐릭터와 동일하게 둔다
      this.state = createInitialState([local, local]);
      data.session.transport.onMessage((channel, bytes) => {
        if (channel === 'input') {
          const decoded = decodeInput(bytes);
          if (decoded) this.remoteInput = decoded.frame;
        } else if (channel === 'event') {
          const character = decodeCharacter(bytes);
          if (character) setPlayerCharacter(this.state, remoteId, character);
        }
      });
      data.session.transport.onClose(() => this.scene.start('Title'));
      data.session.transport.send('event', encodeCharacter(local));
    } else {
      this.session = undefined;
      this.localId = 0;
      this.state = createInitialState([local, this.soloOpponent(local)]);
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
      this.stepOnce();
      this.accumulator -= SIM.dt;
    }
    this.render();
  }

  private soloOpponent(local: CharacterId): CharacterId {
    return characterAt(characterIndex(local) + 1);
  }

  private makeNameLabel(): Phaser.GameObjects.Text {
    const label = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5, 1);
    this.world.add(label);
    return label;
  }

  private stepOnce(): void {
    const local = this.readLocalInput();
    if (this.session) this.session.transport.send('input', encodeInput(this.state.tick, local));

    const inputs: [InputFrame, InputFrame] =
      this.localId === 0 ? [local, this.remoteInput] : [this.remoteInput, local];
    step(this.state, inputs);

    const [p0, p1] = this.state.players;
    if (p0.hp <= 0 || p1.hp <= 0) {
      const winner = p0.hp > 0 ? 0 : 1;
      this.scene.start('Result', { winner, localId: this.localId, session: this.session });
    }
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
    const g = this.gfx;
    g.clear();

    g.lineStyle(2, 0x2a3552, 1);
    g.strokeRect(0, 0, SIM.arenaW, SIM.arenaH);

    for (const p of this.state.players) {
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
      label.setText(`${character.name}${p.id === this.localId ? ' (나)' : ''}`);
    }

    g.fillStyle(0xffe066, 1);
    for (const b of this.state.bullets) g.fillCircle(b.x, b.y, SIM.bulletRadius);

    const [p0, p1] = this.state.players;
    const hp = (p: typeof p0) => `${CHARACTERS[p.character].name} ${p.hp}/${CHARACTERS[p.character].stats.maxHp}`;
    const rtt = this.session ? `  RTT ${this.session.transport.rtt.toFixed(0)}ms (${this.session.transport.kind})` : '';
    this.hud.setText(`${hp(p0)}   vs   ${hp(p1)}   tick ${this.state.tick}${rtt}`);
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
    this.scale.off('resize', this.layout, this);
    this.moveStick.destroy();
    this.aimStick.destroy();
  }
}
