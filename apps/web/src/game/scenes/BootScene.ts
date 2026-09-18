import Phaser from 'phaser';
import { consumeJoinCodeFromUrl } from '../../net/pairing';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const code = consumeJoinCodeFromUrl();
    if (code) this.scene.start('Lobby', { role: 'guest', code });
    else this.scene.start('Title');
  }
}
