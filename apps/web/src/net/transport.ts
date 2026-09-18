export type Channel = 'input' | 'event';

export type MessageHandler = (channel: Channel, data: Uint8Array) => void;
export type Unsubscribe = () => void;

export interface Transport {
  readonly kind: 'webrtc' | 'relay';
  readonly rtt: number;
  send(channel: Channel, data: Uint8Array): void;
  onMessage(handler: MessageHandler): Unsubscribe;
  onClose(handler: () => void): Unsubscribe;
  close(): void;
}
