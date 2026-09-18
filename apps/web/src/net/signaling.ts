import type { ClientToServer, ServerToClient } from '@shooter/protocol';

type MessageOf<T extends ServerToClient['t']> = Extract<ServerToClient, { t: T }>;

export function defaultSignalingUrl(): string {
  const fromEnv = import.meta.env.VITE_SIGNALING_URL;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class SignalingClient {
  private readonly ws: WebSocket;
  private readonly opened: Promise<void>;
  private readonly listeners = new Set<(msg: ServerToClient) => void>();
  private readonly binaryListeners = new Set<(data: Uint8Array) => void>();

  constructor(url = defaultSignalingUrl()) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('signaling connection failed')), { once: true });
    });
    this.ws.addEventListener('message', (ev: MessageEvent) => {
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

  send(msg: ClientToServer): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendBinary(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
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
          reject(new Error(msg.code));
        }
      });
    });
  }

  async createRoom(): Promise<string> {
    await this.ready();
    this.send({ t: 'create_room' });
    return (await this.waitFor('room_created')).code;
  }

  async joinRoom(code: string): Promise<void> {
    await this.ready();
    this.send({ t: 'join_room', code });
    await this.waitFor('room_joined');
  }

  close(): void {
    this.ws.close();
  }
}
