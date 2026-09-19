import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';

// 나쁜 네트워크 흉내: 진짜 전송로를 감싸 지연·흔들림·손실을 넣는다. 같은 Wi‑Fi에서 원거리 상황을 시험할 때 쓴다.

export interface NetSimOptions {
  lagMs: number; // 편도 지연 (ms)
  jitterMs: number; // 지연에 더하는 무작위 흔들림 (0..jitterMs)
  lossPct: number; // 입력 채널 손실률 (%)
}

// URL 예: ?lag=120&jitter=30&loss=10  (손실은 unreliable한 input 채널에만 적용)
export function netSimFromUrl(): NetSimOptions | null {
  const q = new URLSearchParams(location.search);
  const opts: NetSimOptions = {
    lagMs: Number(q.get('lag') ?? 0) || 0, // 숫자가 아니면 0
    jitterMs: Number(q.get('jitter') ?? 0) || 0,
    lossPct: Number(q.get('loss') ?? 0) || 0,
  };
  return opts.lagMs > 0 || opts.jitterMs > 0 || opts.lossPct > 0 ? opts : null; // 아무것도 없으면 포장하지 않는다
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
    return this.inner.rtt + 2 * this.opts.lagMs; // 보낼 때와 받을 때 둘 다 지연하므로 왕복은 두 배
  }

  send(channel: Channel, data: Uint8Array): void {
    if (this.shouldDrop(channel)) return;
    const copy = data.slice(); // 나중에 보낼 것이므로 원본이 바뀌어도 되게 복사
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

  // event 채널은 실제로도 신뢰 채널이라 잃지 않으므로 손실을 넣지 않는다
  private shouldDrop(channel: Channel): boolean {
    return channel === 'input' && Math.random() * 100 < this.opts.lossPct;
  }

  // 흔들림 때문에 순서가 바뀔 수 있다. 실제 unreliable 채널과 같은 성질이다
  private delay(): number {
    return this.opts.lagMs + Math.random() * this.opts.jitterMs;
  }
}
