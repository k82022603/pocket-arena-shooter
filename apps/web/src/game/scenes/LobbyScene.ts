import Phaser from 'phaser';
import QRCode from 'qrcode';
import { hostSession, joinSession, type Session } from '../../net/connect';
import { isLocalOnlyHost, joinUrlFor, parseJoinCode } from '../../net/pairing';
import { cameraAvailable, promptCode, scanQr, toast } from '../../ui/overlay';
import { sfx } from '../audio/Sfx';
import { TYPE, accentOf, applySkinBackground, fontPx, makeButton, makeLabel, px, sizeButton, skin, styleButton } from '../ui';
import { CHARACTERS } from '../../sim/characters';
import { selectedCharacter } from './TitleScene';

interface LobbyData {
  role: 'host' | 'guest';
  code?: string;
}

export class LobbyScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private session?: Session;
  private qrKey: string | null = null;
  private busy = false;

  constructor() {
    super('Lobby');
  }

  create(data: LobbyData): void {
    const { width, height } = this.scale;
    this.session = undefined;
    this.qrKey = null;
    this.busy = false;

    applySkinBackground(this);
    this.status = makeLabel(this, width / 2, height * 0.42, '', TYPE.heading - 4);
    sizeButton(makeButton(this, px(this, 56), px(this, 28), '← 뒤로', () => this.leave(), TYPE.body, 'ghost'), 88, 36);
    this.events.once('shutdown', this.cleanup, this);

    if (data.role === 'host') void this.runHost();
    else if (data.code) void this.joinWith(data.code);
    else this.showGuestMenu();
  }

  private async runHost(): Promise<void> {
    this.setStatus('방 만드는 중…');
    try {
      const session = await hostSession((code) => this.showHostRoom(code));
      this.onConnected(session);
    } catch (err) {
      this.setStatus(`연결 실패: ${(err as Error).message}`);
    }
  }

  private showHostRoom(code: string): void {
    const { width, height } = this.scale;
    const url = joinUrlFor(code);
    const size = Math.min(height * 0.62, width * 0.38);

    const canvas = document.createElement('canvas');
    QRCode.toCanvas(canvas, url, { width: 512, margin: 1, color: { dark: '#0b0f1a', light: '#ffffff' } }, (err) => {
      if (err) return;
      this.qrKey = `qr-${code}`;
      this.textures.addCanvas(this.qrKey, canvas);
      const img = this.add.image(width * 0.28, height * 0.5, this.qrKey).setDisplaySize(size, size);
      this.add.rectangle(img.x, img.y, size + 16, size + 16).setStrokeStyle(2, 0x4cc9f0, 0.6);
    });

    const rx = width * 0.7;
    const u = (n: number) => px(this, n);
    this.status.setPosition(rx, height * 0.72).setFontSize(u(TYPE.body + 2));
    makeLabel(this, rx, height * 0.2, '방 코드', TYPE.body).setColor(skin().textDim);
    this.add
      .text(rx, height * 0.33, code, { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: fontPx(this, 56), color: '#ffffff' })
      .setOrigin(0.5)
      .setLetterSpacing(u(8));
    const reachable = !new URL(url).hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/);
    makeLabel(this, rx, height * 0.45, 'QR을 찍거나 코드를 입력하면 시작됩니다', TYPE.body);
    makeLabel(this, rx, height * 0.52, reachable ? url : '이 PC에서만 열 수 있는 주소입니다 — npm run play 로 실행하세요', TYPE.caption).setColor(
      reachable ? '#8fa3c8' : '#ff8a80',
    );
    if (!reachable && isLocalOnlyHost()) toast('폰에서 접속하려면 LAN 주소로 열어야 합니다', 3000);
    sizeButton(makeButton(this, rx - u(70), height * 0.6, '링크 복사', () => void this.copyLink(url), TYPE.body), 130, 38);
    sizeButton(makeButton(this, rx + u(70), height * 0.6, '공유', () => void this.share(url, code), TYPE.body), 130, 38);
    this.setStatus('상대를 기다리는 중…');
  }

  private async copyLink(url: string): Promise<void> {
    sfx.ui();
    try {
      await navigator.clipboard.writeText(url);
      toast('참가 링크를 복사했습니다');
    } catch {
      toast('복사할 수 없습니다 — 코드를 알려주세요');
    }
  }

  private async share(url: string, code: string): Promise<void> {
    sfx.ui();
    if (!navigator.share) return void this.copyLink(url);
    try {
      await navigator.share({ title: 'Arena Shooter', text: `방 코드 ${code}`, url });
    } catch {
      /* 사용자가 공유를 취소함 */
    }
  }

  private showGuestMenu(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.setStatus('');
    makeLabel(this, cx, height * 0.22, '참가하기', TYPE.heading);
    const camera = cameraAvailable();
    const accent = accentOf(CHARACTERS[selectedCharacter(this)].color);
    const scan = sizeButton(makeButton(this, cx, height * 0.42, 'QR 스캔', () => void this.scan(), TYPE.button, 'action'), 220, 46);
    styleButton(scan, 'action', accent);
    if (!camera) {
      scan.setAlpha(0.4).disableInteractive();
      makeLabel(this, cx, height * 0.42 + px(this, 36), window.isSecureContext ? '이 기기에서는 카메라를 쓸 수 없습니다' : 'https로 접속해야 카메라를 쓸 수 있습니다', TYPE.caption);
    }
    styleButton(sizeButton(makeButton(this, cx, height * 0.6, '코드 입력', () => void this.enterCode(), TYPE.button, 'action'), 220, 46), 'action', accent);
    makeLabel(this, cx, height * 0.8, '호스트 QR을 폰 카메라로 찍어 링크를 열어도 바로 참가됩니다', TYPE.caption).setColor(skin().textDim);
  }

  private async scan(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    sfx.ui();
    try {
      const text = await scanQr();
      if (text === null) return;
      const code = parseJoinCode(text);
      if (!code) {
        toast('이 게임의 참가 QR이 아닙니다');
        return;
      }
      await this.joinWith(code);
    } catch {
      toast('카메라를 열 수 없습니다 — 코드를 입력해 주세요');
    } finally {
      this.busy = false;
    }
  }

  private async enterCode(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    sfx.ui();
    try {
      const code = await promptCode();
      if (code) await this.joinWith(code);
    } finally {
      this.busy = false;
    }
  }

  private async joinWith(code: string): Promise<void> {
    this.setStatus(`방 ${code}에 연결 중…`);
    try {
      this.onConnected(await joinSession(code));
    } catch (err) {
      const message = (err as Error).message;
      const friendly =
        message === 'room_not_found' ? '방을 찾을 수 없습니다' : message === 'room_full' ? '방이 이미 찼습니다' : `연결 실패: ${message}`;
      this.setStatus(friendly);
      toast(friendly);
    }
  }

  private onConnected(session: Session): void {
    this.session = session;
    this.setStatus(`연결됨 (${session.kind})`);
    sfx.revive();
    this.time.delayedCall(800, () => {
      this.scene.start('Arena', { mode: 'versus', session });
    });
  }

  private setStatus(text: string): void {
    this.status.setText(text);
  }

  private leave(): void {
    sfx.ui();
    this.session?.close();
    this.scene.start('Title');
  }

  private cleanup(): void {
    if (this.qrKey && this.textures.exists(this.qrKey)) this.textures.remove(this.qrKey);
  }
}
