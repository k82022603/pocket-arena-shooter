import Phaser from 'phaser';
import { ROOM_CODE_LENGTH } from '@shooter/protocol';
import { hostSession, joinSession, type Session } from '../../net/connect';
import { makeButton, makeLabel } from '../ui';

interface LobbyData {
  role: 'host' | 'guest';
}

export class LobbyScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private session?: Session;

  constructor() {
    super('Lobby');
  }

  create(data: LobbyData): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.status = makeLabel(this, cx, height * 0.4, '', 26);
    makeButton(this, cx, height * 0.8, '뒤로', () => this.leave());

    void (data.role === 'host' ? this.runHost() : this.runGuest());
  }

  private async runHost(): Promise<void> {
    this.setStatus('방 만드는 중…');
    try {
      const session = await hostSession((code) => this.setStatus(`방 코드\n\n${code}\n\n상대가 입력하면 시작됩니다`));
      this.onConnected(session);
    } catch (err) {
      this.setStatus(`연결 실패: ${(err as Error).message}`);
    }
  }

  private async runGuest(): Promise<void> {
    const code = window.prompt(`${ROOM_CODE_LENGTH}자리 방 코드를 입력하세요`)?.trim();
    if (!code || code.length !== ROOM_CODE_LENGTH) return this.leave();
    this.setStatus('연결 중…');
    try {
      this.onConnected(await joinSession(code));
    } catch (err) {
      this.setStatus(`연결 실패: ${(err as Error).message}`);
    }
  }

  private onConnected(session: Session): void {
    this.session = session;
    this.setStatus(`연결됨 (${session.transport.kind})`);
    this.time.delayedCall(800, () => {
      this.scene.start('Arena', { mode: 'versus', session });
    });
  }

  private setStatus(text: string): void {
    this.status.setText(text);
  }

  private leave(): void {
    this.session?.transport.close();
    this.session?.signaling.close();
    this.scene.start('Title');
  }
}
