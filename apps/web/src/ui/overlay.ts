import jsQR from 'jsqr';
import { ROOM_CODE_LENGTH } from '@shooter/protocol';
import { isRoomCode } from '../net/pairing';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | null {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

function mount(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// 6자리 방 코드 입력. 취소하면 null.
export function promptCode(): Promise<string | null> {
  return new Promise((resolve) => {
    const el = mount(`
      <div class="panel">
        <div class="panel-title">방 코드 입력</div>
        <input class="code-input" inputmode="numeric" pattern="[0-9]*" maxlength="${ROOM_CODE_LENGTH}" autocomplete="one-time-code" placeholder="${'0'.repeat(ROOM_CODE_LENGTH)}" />
        <div class="panel-actions">
          <button class="btn secondary" data-act="cancel">취소</button>
          <button class="btn" data-act="ok" disabled>참가</button>
        </div>
      </div>`);
    const input = el.querySelector<HTMLInputElement>('.code-input')!;
    const ok = el.querySelector<HTMLButtonElement>('[data-act=ok]')!;
    const done = (value: string | null) => {
      el.remove();
      resolve(value);
    };
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
      ok.disabled = !isRoomCode(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && isRoomCode(input.value)) done(input.value);
      if (e.key === 'Escape') done(null);
    });
    ok.addEventListener('click', () => done(input.value));
    el.querySelector('[data-act=cancel]')!.addEventListener('click', () => done(null));
    setTimeout(() => input.focus(), 50);
  });
}

export function cameraAvailable(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

// 카메라로 QR을 읽어 원문을 돌려준다. 취소하면 null, 카메라를 못 열면 throw.
export async function scanQr(): Promise<string | null> {
  const el = mount(`
    <div class="scanner">
      <video autoplay playsinline muted></video>
      <div class="scan-frame"></div>
      <div class="scan-hint">호스트 화면의 QR 코드를 비추세요</div>
      <button class="btn secondary scan-cancel" data-act="cancel">취소</button>
    </div>`);
  const video = el.querySelector<HTMLVideoElement>('video')!;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    el.remove();
    throw err;
  }
  video.srcObject = stream;
  await video.play();

  const Detector = barcodeDetector();
  const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return new Promise((resolve) => {
    let active = true;
    const finish = (value: string | null) => {
      if (!active) return;
      active = false;
      for (const track of stream.getTracks()) track.stop();
      el.remove();
      resolve(value);
    };
    el.querySelector('[data-act=cancel]')!.addEventListener('click', () => finish(null));

    const tick = async () => {
      if (!active) return;
      if (video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            const hit = codes[0]?.rawValue;
            if (hit) return finish(hit);
          } else if (ctx) {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.floor(video.videoWidth * scale);
            canvas.height = Math.floor(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (hit?.data) return finish(hit.data);
          }
        } catch {
          /* 프레임 단위 실패는 무시하고 계속 시도 */
        }
      }
      setTimeout(() => void tick(), detector ? 120 : 200);
    };
    void tick();
  });
}

export function toast(message: string, ms = 1800): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
