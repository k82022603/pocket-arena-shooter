import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';
import type { SignalingClient } from './signaling';

// WebSocket 릴레이 전송. P2P가 5초 안에 붙지 않으면 시그널링 서버를 거쳐 게임 패킷을 주고받는다.
// 채널 구분이 없는 하나의 소켓이라 첫 바이트에 채널 번호를 붙여 보낸다.

const CHANNEL_ID: Record<Channel, number> = { input: 0, event: 1 };
const CHANNEL_NAME: Channel[] = ['input', 'event']; // 번호 → 이름

export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  rtt = 0; // 릴레이는 핑을 재지 않는다

  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly signaling: SignalingClient) {
    this.unsubscribe = signaling.onBinary((bytes) => {
      const name = CHANNEL_NAME[bytes[0] ?? 255];
      if (!name) return; // 모르는 채널 번호는 버린다
      const payload = bytes.subarray(1); // 채널 번호를 뗀 나머지 (복사 없이 같은 메모리를 가리킨다)
      for (const fn of this.messageHandlers) fn(name, payload);
    });
    signaling.onClose(() => this.close()); // 시그널링 소켓이 닫히면 이 전송로도 끝
  }

  send(channel: Channel, data: Uint8Array): void {
    const framed = new Uint8Array(data.byteLength + 1);
    framed[0] = CHANNEL_ID[channel]; // [채널 번호][원래 패킷]
    framed.set(data, 1);
    this.signaling.sendBinary(framed);
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: () => void): Unsubscribe {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    if (this.closed) return; // 두 번 닫아도 처리기는 한 번만 부른다
    this.closed = true;
    this.unsubscribe();
    for (const fn of this.closeHandlers) fn();
  }
}
