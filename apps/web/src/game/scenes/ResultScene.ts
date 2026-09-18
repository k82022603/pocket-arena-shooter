import Phaser from 'phaser';
import type { Session } from '../../net/connect';
import { makeButton, makeLabel } from '../ui';

interface ResultData {
  winner: 0 | 1;
  localId: 0 | 1;
  session?: Session;
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    const title = data.session ? (data.winner === data.localId ? '승리!' : '패배') : 'P1 승리';
    makeLabel(this, cx, height * 0.35, title, 56);

    makeButton(this, cx, height * 0.6, '다시 하기', () => {
      this.scene.start('Arena', data.session ? { mode: 'versus', session: data.session } : { mode: 'solo' });
    });
    makeButton(this, cx, height * 0.6 + 70, '타이틀로', () => {
      data.session?.transport.close();
      data.session?.signaling.close();
      this.scene.start('Title');
    });
  }
}
