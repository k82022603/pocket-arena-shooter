import type { PeerRole } from '@shooter/protocol';
import { SignalingClient } from './signaling';
import { WebRtcTransport } from './webrtc';
import { RelayTransport } from './relay';
import { SimulatedTransport, netSimFromUrl } from './simulated';
import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';

export type LinkState = 'connected' | 'reconnecting' | 'failed' | 'closed';
export type FailReason = 'peer_left' | 'rejoin_failed';
export type LinkEvent = 'reconnecting' | 'reconnected' | 'failed';

// 이 시간 안에 복구하지 못하면 경기를 끝낸다. 서버 유예(15초)보다 짧아야 한다.
export const RECONNECT_WINDOW_MS = 10_000;
// 핸들러가 없는 동안 보관할 event 메시지 수 상한
const PENDING_EVENT_LIMIT = 16;
const NEGOTIATE_TIMEOUT_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function negotiateTransport(signaling: SignalingClient, role: PeerRole, timeoutMs: number): Promise<Transport> {
  const rtc = new WebRtcTransport(signaling, role);
  let transport: Transport;
  try {
    await rtc.connect(timeoutMs);
    transport = rtc;
  } catch (err) {
    console.warn('[net] WebRTC 실패, 릴레이로 전환:', (err as Error).message);
    rtc.close();
    signaling.send({ t: 'signal', data: { kind: 'use_relay' } });
    transport = wrapNetSim(new RelayTransport(signaling));
    return transport;
  }
  return wrapNetSim(transport);
}

function wrapNetSim(transport: Transport): Transport {
  const sim = netSimFromUrl();
  return sim ? new SimulatedTransport(transport, sim) : transport;
}

// 시그널링·전송 계층을 묶어 끊김을 감지하고 재접속한다. 게임 코드는 전송이 바뀌어도 이 객체만 본다.
export class SessionLink {
  state: LinkState = 'connected';
  deadline = 0;
  failReason: FailReason | null = null;

  private transport: Transport | null = null;
  private readonly handlers = new Set<MessageHandler>();
  // 씬이 바뀌는 사이에는 핸들러가 잠시 비어 있다. 그때 도착한 event 메시지를 그냥 버리면
  // 참가한 쪽이 먼저 아레나에 들어가 보낸 캐릭터 선택이 사라져, 두 사람이 같은 파티마가 된다.
  // event 채널은 한 번 놓치면 복구 경로가 없으므로 붙을 때까지 들고 있는다.
  private readonly pending: { channel: Channel; data: Uint8Array }[] = [];
  private readonly listeners = new Map<LinkEvent, Set<(reason?: FailReason) => void>>();
  private transportUnsubs: Unsubscribe[] = [];
  private signalingUnsubs: Unsubscribe[] = [];
  private rejoining = false;
  private negotiating: Promise<void> | null = null;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    readonly role: PeerRole,
    readonly code: string,
    private readonly token: string,
    private signaling: SignalingClient,
    transport: Transport,
  ) {
    this.attachTransport(transport);
    this.attachSignaling();
  }

  get kind(): Transport['kind'] {
    return this.transport?.kind ?? 'webrtc';
  }

  get rtt(): number {
    return this.transport?.rtt ?? 0;
  }

  get connected(): boolean {
    return this.state === 'connected' && this.transport !== null;
  }

  send(channel: Channel, data: Uint8Array): void {
    if (this.state === 'connected') this.transport?.send(channel, data);
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    const first = this.handlers.size === 0;
    this.handlers.add(handler);
    if (first && this.pending.length > 0) {
      const queued = this.pending.splice(0, this.pending.length);
      for (const m of queued) handler(m.channel, m.data);
    }
    return () => this.handlers.delete(handler);
  }

  on(event: LinkEvent, fn: (reason?: FailReason) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.state = 'closed';
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.detachTransport();
    for (const off of this.signalingUnsubs) off();
    this.signaling.close();
  }

  private emit(event: LinkEvent, reason?: FailReason): void {
    for (const fn of this.listeners.get(event) ?? []) fn(reason);
  }

  private attachTransport(transport: Transport): void {
    this.detachTransport();
    this.transport = transport;
    this.transportUnsubs = [
      transport.onMessage((channel, data) => {
        if (this.handlers.size === 0) {
          // 지연 도착한 입력·스냅샷은 버려도 되지만 event는 보관한다
          if (channel === 'event' && this.pending.length < PENDING_EVENT_LIMIT) {
            this.pending.push({ channel, data: data.slice() });
          }
          return;
        }
        for (const fn of this.handlers) fn(channel, data);
      }),
      transport.onClose(() => this.handleTransportClosed(transport)),
    ];
  }

  private detachTransport(): void {
    for (const off of this.transportUnsubs) off();
    this.transportUnsubs = [];
    const old = this.transport;
    this.transport = null;
    old?.close();
  }

  private attachSignaling(): void {
    for (const off of this.signalingUnsubs) off();
    const offMessage = this.signaling.onMessage((msg) => {
      if (this.closed) return;
      switch (msg.t) {
        case 'peer_disconnected':
          this.startWindow();
          return;
        // 상대가 같은 페이지로 돌아오면 peer_rejoined, 새 페이지로 다시 참가하면 peer_joined가 온다.
        case 'peer_rejoined':
        case 'peer_joined':
          void this.negotiate();
          return;
        case 'peer_left':
          this.fail('peer_left');
          return;
        case 'signal':
          if (msg.data.kind === 'use_relay') this.switchToRelay();
          return;
      }
    });
    const signaling = this.signaling;
    signaling.onClose(() => {
      if (this.closed || signaling !== this.signaling) return;
      void this.rejoin();
    });
    this.signalingUnsubs = [offMessage];
  }

  private handleTransportClosed(transport: Transport): void {
    if (this.closed || transport !== this.transport) return;
    for (const off of this.transportUnsubs) off();
    this.transportUnsubs = [];
    this.transport = null;
    // 호스트는 시그널링이 살아 있으면 상대의 rejoin 통지(peer_rejoined)를 기다리고, 게스트가 재협상을 요청한다.
    if (this.role === 'host' && this.signaling.isOpen) this.startWindow();
    else void this.rejoin();
  }

  private startWindow(): void {
    if (this.state !== 'connected' || this.closed) return;
    this.state = 'reconnecting';
    this.deadline = performance.now() + RECONNECT_WINDOW_MS;
    this.emit('reconnecting');
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowTimer = setTimeout(() => {
      // 내가 재접속을 시도하던 중이면 내가 떨어진 쪽, 상대를 기다리기만 했으면 상대가 떠난 것이다.
      if (this.state === 'reconnecting') this.fail(this.rejoining ? 'rejoin_failed' : 'peer_left');
    }, RECONNECT_WINDOW_MS);
  }

  // 테스트용: 시그널링 소켓이나 전송 계층을 강제로 끊는다.
  debugDrop(kind: 'signaling' | 'transport'): void {
    if (kind === 'signaling') this.signaling.close();
    else this.transport?.close();
  }

  private async rejoin(): Promise<void> {
    if (this.closed || this.rejoining) return;
    this.rejoining = true;
    this.startWindow();
    try {
      while (this.state === 'reconnecting' && !this.closed) {
        try {
          if (!this.signaling.isOpen) {
            this.signaling.close();
            this.signaling = new SignalingClient();
            this.attachSignaling();
            await this.signaling.ready();
          }
          await this.signaling.rejoin(this.code, this.token);
          await this.negotiate();
          return;
        } catch (err) {
          const message = (err as Error).message;
          if (message === 'room_not_found' || message === 'bad_token') break;
          await sleep(700);
        }
      }
    } finally {
      this.rejoining = false;
    }
    if (this.state === 'reconnecting') this.fail('rejoin_failed');
  }

  private negotiate(): Promise<void> {
    if (this.closed || this.state === 'failed') return Promise.resolve();
    if (this.negotiating) return this.negotiating;
    this.negotiating = (async () => {
      const transport = await negotiateTransport(this.signaling, this.role, NEGOTIATE_TIMEOUT_MS);
      if (this.closed) {
        transport.close();
        return;
      }
      this.attachTransport(transport);
      if (this.windowTimer) clearTimeout(this.windowTimer);
      this.windowTimer = null;
      this.deadline = 0;
      this.state = 'connected';
      this.emit('reconnected');
    })().finally(() => {
      this.negotiating = null;
    });
    return this.negotiating;
  }

  // 상대가 릴레이로 내려갔으면 내 WebRTC가 살아 있어도 서로 다른 경로라 통신이 안 되므로 같이 내려간다.
  private switchToRelay(): void {
    if (this.closed || this.state === 'failed' || this.transport?.kind === 'relay') return;
    this.attachTransport(wrapNetSim(new RelayTransport(this.signaling)));
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowTimer = null;
    this.deadline = 0;
    this.state = 'connected';
    this.emit('reconnected');
  }

  private fail(reason: FailReason): void {
    if (this.closed || this.state === 'failed') return;
    this.state = 'failed';
    this.failReason = reason;
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.emit('failed', reason);
  }
}
