import type { PeerRole } from '@shooter/protocol';
import { SignalingClient } from './signaling';
import { WebRtcTransport } from './webrtc';
import { RelayTransport } from './relay';
import { SimulatedTransport, netSimFromUrl } from './simulated';
import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';

export type LinkState = 'connected' | 'reconnecting' | 'failed' | 'closed';
export type FailReason = 'peer_left' | 'rejoin_failed'; // 상대가 떠났다 | 내가 다시 붙지 못했다
export type LinkEvent = 'reconnecting' | 'reconnected' | 'failed';

// 이 시간 안에 복구하지 못하면 경기를 끝낸다. 서버 유예(15초)보다 짧아야 한다.
export const RECONNECT_WINDOW_MS = 10_000;
// 핸들러가 없는 동안 보관할 event 메시지 수 상한
const PENDING_EVENT_LIMIT = 16;
const NEGOTIATE_TIMEOUT_MS = 8_000; // 재접속 때의 P2P 협상 대기 (처음 연결보다 넉넉하게)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// WebRTC를 먼저 시도하고, 시간 안에 안 붙으면 상대에게 알리고 릴레이로 내려간다
export async function negotiateTransport(signaling: SignalingClient, role: PeerRole, timeoutMs: number): Promise<Transport> {
  const rtc = new WebRtcTransport(signaling, role);
  let transport: Transport;
  try {
    await rtc.connect(timeoutMs);
    transport = rtc;
  } catch (err) {
    console.warn('[net] WebRTC 실패, 릴레이로 전환:', (err as Error).message);
    rtc.close();
    signaling.send({ t: 'signal', data: { kind: 'use_relay' } }); // 상대도 같이 내려오게 한다
    transport = wrapNetSim(new RelayTransport(signaling));
    return transport;
  }
  return wrapNetSim(transport);
}

// URL에 ?lag=…&loss=… 가 있으면 지연·손실을 흉내 내는 포장을 씌운다 (테스트용)
function wrapNetSim(transport: Transport): Transport {
  const sim = netSimFromUrl();
  return sim ? new SimulatedTransport(transport, sim) : transport;
}

// 시그널링·전송 계층을 묶어 끊김을 감지하고 재접속한다. 게임 코드는 전송이 바뀌어도 이 객체만 본다.
export class SessionLink {
  state: LinkState = 'connected';
  deadline = 0; // 재접속을 포기하는 시각 (performance.now 기준, 화면의 남은 초 표시용)
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
  private rejoining = false; // 내가 재접속을 시도하는 중인가
  private negotiating: Promise<void> | null = null; // 진행 중인 협상 (중복 시작을 막는다)
  private windowTimer: ReturnType<typeof setTimeout> | null = null; // 재접속 유예 타이머
  private closed = false;

  constructor(
    readonly role: PeerRole,
    readonly code: string, // 방 코드
    private readonly token: string, // 재접속 토큰
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
    if (this.state === 'connected') this.transport?.send(channel, data); // 재접속 중에는 보내지 않는다
  }

  // 처리기를 붙인다. 처음 붙는 처리기에는 그동안 보관한 event 메시지를 먼저 넘긴다
  onMessage(handler: MessageHandler): Unsubscribe {
    const first = this.handlers.size === 0;
    this.handlers.add(handler);
    if (first && this.pending.length > 0) {
      const queued = this.pending.splice(0, this.pending.length); // 꺼내면서 비운다
      for (const m of queued) handler(m.channel, m.data);
    }
    return () => this.handlers.delete(handler);
  }

  // 연결 상태 사건(재접속 중·복구·실패)을 구독한다
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
    this.signaling.close(); // 서버가 방을 정리하고 상대에게 peer_left를 보낸다
  }

  private emit(event: LinkEvent, reason?: FailReason): void {
    for (const fn of this.listeners.get(event) ?? []) fn(reason);
  }

  // 새 전송로를 붙인다. 이전 것은 떼고 닫는다
  private attachTransport(transport: Transport): void {
    this.detachTransport();
    this.transport = transport;
    this.transportUnsubs = [
      transport.onMessage((channel, data) => {
        if (this.handlers.size === 0) {
          // 지연 도착한 입력·스냅샷은 버려도 되지만 event는 보관한다
          if (channel === 'event' && this.pending.length < PENDING_EVENT_LIMIT) {
            this.pending.push({ channel, data: data.slice() }); // 수신 버퍼가 재사용될 수 있어 복사해 둔다
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

  // 시그널링 서버가 보내는 상대 상태 알림을 듣는다
  private attachSignaling(): void {
    for (const off of this.signalingUnsubs) off();
    const offMessage = this.signaling.onMessage((msg) => {
      if (this.closed) return;
      switch (msg.t) {
        case 'peer_disconnected': // 상대 소켓이 끊겼다: 유예 시간을 시작하고 기다린다
          this.startWindow();
          return;
        // 상대가 같은 페이지로 돌아오면 peer_rejoined, 새 페이지로 다시 참가하면 peer_joined가 온다.
        case 'peer_rejoined':
        case 'peer_joined':
          void this.negotiate();
          return;
        case 'peer_left': // 상대가 나갔거나 유예가 끝났다
          this.fail('peer_left');
          return;
        case 'signal':
          if (msg.data.kind === 'use_relay') this.switchToRelay();
          return;
      }
    });
    const signaling = this.signaling;
    signaling.onClose(() => {
      if (this.closed || signaling !== this.signaling) return; // 이미 새 소켓으로 바꿨으면 무시
      void this.rejoin(); // 내 시그널링이 끊겼다: 내가 다시 붙어야 한다
    });
    this.signalingUnsubs = [offMessage];
  }

  private handleTransportClosed(transport: Transport): void {
    if (this.closed || transport !== this.transport) return; // 이미 교체된 옛 전송로의 닫힘은 무시
    for (const off of this.transportUnsubs) off();
    this.transportUnsubs = [];
    this.transport = null;
    // 호스트는 시그널링이 살아 있으면 상대의 rejoin 통지(peer_rejoined)를 기다리고, 게스트가 재협상을 요청한다.
    if (this.role === 'host' && this.signaling.isOpen) this.startWindow();
    else void this.rejoin();
  }

  // 재접속 유예를 시작한다. 이 시간 안에 복구되지 않으면 실패
  private startWindow(): void {
    if (this.state !== 'connected' || this.closed) return; // 이미 유예 중이면 다시 시작하지 않는다
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

  // 시그널링에 다시 붙어 토큰으로 방에 재입장하고 전송로를 다시 협상한다. 유예 안에서 반복 시도
  private async rejoin(): Promise<void> {
    if (this.closed || this.rejoining) return;
    this.rejoining = true;
    this.startWindow();
    try {
      while (this.state === 'reconnecting' && !this.closed) {
        try {
          if (!this.signaling.isOpen) {
            // 소켓이 죽었으면 새로 연다
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
          if (message === 'room_not_found' || message === 'bad_token') break; // 방이 없어졌으면 더 해도 소용없다
          await sleep(700); // 잠깐 쉬고 다시
        }
      }
    } finally {
      this.rejoining = false;
    }
    if (this.state === 'reconnecting') this.fail('rejoin_failed');
  }

  // 전송로를 새로 협상한다. 동시에 여러 번 불려도 한 번만 진행한다
  private negotiate(): Promise<void> {
    if (this.closed || this.state === 'failed') return Promise.resolve();
    if (this.negotiating) return this.negotiating;
    this.negotiating = (async () => {
      const transport = await negotiateTransport(this.signaling, this.role, NEGOTIATE_TIMEOUT_MS);
      if (this.closed) {
        transport.close(); // 협상하는 사이에 세션이 닫혔다
        return;
      }
      this.attachTransport(transport);
      // 복구 완료: 유예를 풀고 알린다
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
    if (this.closed || this.state === 'failed') return; // 실패는 한 번만 알린다
    this.state = 'failed';
    this.failReason = reason;
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.emit('failed', reason);
  }
}
