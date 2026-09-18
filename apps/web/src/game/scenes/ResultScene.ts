import Phaser from 'phaser';
import type { Session } from '../../net/connect';
import type { Outcome } from '../../sim/core';
import { COOP } from '../../sim/types';
import { makeButton, makeLabel } from '../ui';

interface ResultData {
  outcome: Outcome;
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

    const { outcome } = data;
    let title: string;
    let subtitle = '';
    if (outcome.mode === 'duel') {
      title = data.session ? (outcome.winner === data.localId ? '승리!' : '패배') : 'P1 승리';
    } else if (outcome.won) {
      title = '방어 성공!';
      subtitle = `${COOP.waves}웨이브 전부 막아냈습니다`;
    } else {
      title = '코어 함락';
      subtitle = `웨이브 ${outcome.wave}/${COOP.waves}에서 패배`;
    }
    makeLabel(this, cx, height * 0.32, title, 56);
    if (subtitle) makeLabel(this, cx, height * 0.32 + 50, subtitle, 20);

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
