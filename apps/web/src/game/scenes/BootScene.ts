import Phaser from 'phaser';
import { consumeJoinCodeFromUrl } from '../../net/pairing';
import { preloadPortraits } from '../fx/Portraits';
import { FONT } from '../ui';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Loading…', { fontFamily: FONT, fontSize: '20px', color: '#8fa3c8' })
      .setOrigin(0.5);
    preloadPortraits(this.load);
  }

  create(): void {
    const code = consumeJoinCodeFromUrl();
    if (code) this.scene.start('Lobby', { role: 'guest', code });
    else this.scene.start('Title');
  }
}
