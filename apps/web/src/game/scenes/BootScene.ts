import Phaser from 'phaser';
import { consumeJoinCodeFromUrl, rememberPendingJoin } from '../../net/pairing';
import { preloadPortraits } from '../fx/Portraits';
import { FONT } from '../ui';

// 첫 장면: 초상 이미지를 미리 읽고, 참가 링크로 열렸으면 방 코드를 챙긴 뒤 타이틀로 넘어간다.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Loading…', { fontFamily: FONT, fontSize: '20px', color: '#8fa3c8' })
      .setOrigin(0.5);
    preloadPortraits(this.load); // 다 읽히면 create()가 불린다
  }

  create(): void {
    // QR/링크로 들어와도 캐릭터와 무기를 고르도록 타이틀을 먼저 보여준다
    const code = consumeJoinCodeFromUrl();
    if (code) rememberPendingJoin(code);
    this.scene.start('Title');
  }
}
