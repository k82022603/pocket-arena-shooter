export type Channel = 'input' | 'event';

export type MessageHandler = (channel: Channel, data: Uint8Array) => void;

export interface Transport {
  readonly kind: 'webrtc' | 'relay';
  readonly rtt: number;
  send(channel: Channel, data: Uint8Array): void;
  onMessage(handler: MessageHandler): void;
  onClose(handler: () => void): void;
  close(): void;
}
