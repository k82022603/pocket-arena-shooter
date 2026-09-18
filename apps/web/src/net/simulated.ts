import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';

export interface NetSimOptions {
  lagMs: number;
  jitterMs: number;
  lossPct: number;
}

// URL 예: ?lag=120&jitter=30&loss=10  (손실은 unreliable한 input 채널에만 적용)
export function netSimFromUrl(): NetSimOptions | null {
  const q = new URLSearchParams(location.search);
  const opts: NetSimOptions = {
    lagMs: Number(q.get('lag') ?? 0) || 0,
    jitterMs: Number(q.get('jitter') ?? 0) || 0,
    lossPct: Number(q.get('loss') ?? 0) || 0,
  };
  return opts.lagMs > 0 || opts.jitterMs > 0 || opts.lossPct > 0 ? opts : null;
}

export class SimulatedTransport implements Transport {
  constructor(
    private readonly inner: Transport,
    private readonly opts: NetSimOptions,
  ) {}

  get kind(): Transport['kind'] {
    return this.inner.kind;
  }

  get rtt(): number {
    return this.inner.rtt + 2 * this.opts.lagMs;
  }

  send(channel: Channel, data: Uint8Array): void {
    if (this.shouldDrop(channel)) return;
    const copy = data.slice();
    setTimeout(() => this.inner.send(channel, copy), this.delay());
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    return this.inner.onMessage((channel, data) => {
      if (this.shouldDrop(channel)) return;
      const copy = data.slice();
      setTimeout(() => handler(channel, copy), this.delay());
    });
  }

  onClose(handler: () => void): Unsubscribe {
    return this.inner.onClose(handler);
  }

  close(): void {
    this.inner.close();
  }

  private shouldDrop(channel: Channel): boolean {
    return channel === 'input' && Math.random() * 100 < this.opts.lossPct;
  }

  private delay(): number {
    return this.opts.lagMs + Math.random() * this.opts.jitterMs;
  }
}
