import type { Channel, MessageHandler, Transport } from './transport';
import type { SignalingClient } from './signaling';

const CHANNEL_ID: Record<Channel, number> = { input: 0, event: 1 };
const CHANNEL_NAME: Channel[] = ['input', 'event'];

export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  rtt = 0;

  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly signaling: SignalingClient) {
    this.unsubscribe = signaling.onBinary((bytes) => {
      const name = CHANNEL_NAME[bytes[0] ?? 255];
      if (!name) return;
      const payload = bytes.subarray(1);
      for (const fn of this.messageHandlers) fn(name, payload);
    });
    signaling.onClose(() => this.close());
  }

  send(channel: Channel, data: Uint8Array): void {
    const framed = new Uint8Array(data.byteLength + 1);
    framed[0] = CHANNEL_ID[channel];
    framed.set(data, 1);
    this.signaling.sendBinary(framed);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const fn of this.closeHandlers) fn();
  }
}
