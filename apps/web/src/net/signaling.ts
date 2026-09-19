import type { ClientToServer, ServerToClient } from '@shooter/protocol';

// 시그널링 서버 클라이언트. 방 만들기·참가·WebRTC 협상 메시지(JSON)와 릴레이 패킷(바이너리)을
// 하나의 WebSocket으로 주고받는다.

type MessageOf<T extends ServerToClient['t']> = Extract<ServerToClient, { t: T }>; // 't' 값으로 메시지 타입을 고른다

// 서버 주소: 환경 변수가 있으면 그것(호스팅된 서버), 없으면 지금 페이지와 같은 호스트의 /ws (개발 서버가 중계)
export function defaultSignalingUrl(): string {
  const fromEnv = import.meta.env.VITE_SIGNALING_URL;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'; // https 페이지에서는 wss만 허용된다
  return `${proto}://${location.host}/ws`;
}

export class SignalingClient {
  private readonly ws: WebSocket;
  private readonly opened: Promise<void>; // 연결이 열리면 풀리는 약속
  private readonly listeners = new Set<(msg: ServerToClient) => void>();
  private readonly binaryListeners = new Set<(data: Uint8Array) => void>();

  constructor(url = defaultSignalingUrl()) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer'; // 바이너리를 Blob이 아니라 ArrayBuffer로 받는다 (동기 처리 가능)
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('signaling connection failed')), { once: true });
    });
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      // 바이너리는 릴레이 게임 패킷, 문자열은 제어 메시지
      if (ev.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(ev.data);
        for (const fn of this.binaryListeners) fn(bytes);
        return;
      }
      const msg = JSON.parse(ev.data as string) as ServerToClient;
      for (const fn of this.listeners) fn(msg);
    });
  }

  ready(): Promise<void> {
    return this.opened;
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientToServer): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendBinary(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data); // 닫힌 소켓에 보내면 예외가 나므로 조용히 버린다
  }

  onMessage(fn: (msg: ServerToClient) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onBinary(fn: (data: Uint8Array) => void): () => void {
    this.binaryListeners.add(fn);
    return () => this.binaryListeners.delete(fn);
  }

  onClose(fn: () => void): void {
    this.ws.addEventListener('close', fn, { once: true });
  }

  // 특정 종류의 메시지가 올 때까지 기다린다. 도중에 error가 오거나 시간이 넘으면 실패
  waitFor<T extends ServerToClient['t']>(type: T, timeoutMs = 10_000): Promise<MessageOf<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      const off = this.onMessage((msg) => {
        if (msg.t === type) {
          clearTimeout(timer);
          off();
          resolve(msg as MessageOf<T>);
        } else if (msg.t === 'error') {
          clearTimeout(timer);
          off();
          reject(new Error(msg.code)); // room_not_found, room_full 등 서버 오류 코드
        }
      });
    });
  }

  // 방을 만들고 6자리 코드와 재접속 토큰을 받는다
  async createRoom(): Promise<{ code: string; token: string }> {
    await this.ready();
    this.send({ t: 'create_room' });
    const msg = await this.waitFor('room_created');
    return { code: msg.code, token: msg.token };
  }

  // 코드로 방에 들어가 재접속 토큰을 받는다
  async joinRoom(code: string): Promise<{ token: string }> {
    await this.ready();
    this.send({ t: 'join_room', code });
    return { token: (await this.waitFor('room_joined')).token };
  }

  // 끊겼던 슬롯에 토큰으로 다시 들어간다
  async rejoin(code: string, token: string): Promise<void> {
    await this.ready();
    this.send({ t: 'rejoin', code, token });
    await this.waitFor('rejoined', 4000);
  }

  close(): void {
    this.ws.close();
  }
}
