import type { SignalPayload } from '@shooter/protocol';
import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';
import type { SignalingClient } from './signaling';

// WebRTC DataChannel 전송. 두 기기가 서버를 거치지 않고 직접 주고받는다(P2P).
// 협상 메시지(offer/answer/ice)만 시그널링 서버를 통해 오간다.

export type PeerRole = 'host' | 'guest';

// 공개 STUN: 각 기기가 자기 바깥 주소를 알아내는 데 쓴다. 같은 Wi‑Fi면 없어도 붙는다
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export class WebRtcTransport implements Transport {
  readonly kind = 'webrtc' as const;
  rtt = 0; // 2초마다 핑으로 잰 왕복 지연 (ms)

  private readonly pc: RTCPeerConnection;
  private readonly channels: Partial<Record<Channel, RTCDataChannel>> = {};
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<() => void>();
  private readonly unsubscribeSignal: () => void;
  private closed = false;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly role: PeerRole,
    iceServers: RTCIceServer[] = DEFAULT_ICE,
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    // 연결 후보(주소)가 찾아질 때마다 상대에게 알린다
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signal({ kind: 'ice', candidate: ev.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') this.close(); // 세션이 재접속을 시작한다
    };
    this.unsubscribeSignal = signaling.onMessage((msg) => {
      if (msg.t === 'signal') void this.handleSignal(msg.data);
    });

    if (role === 'host') {
      // 채널은 방을 만든 쪽이 연다. 참가한 쪽은 ondatachannel로 받는다
      this.attach('input', this.pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 })); // UDP처럼: 순서·재전송 없음
      this.attach('event', this.pc.createDataChannel('event', { ordered: true })); // TCP처럼: 순서 보장, 재전송
    } else {
      this.pc.ondatachannel = (ev) => this.attach(ev.channel.label as Channel, ev.channel);
    }
  }

  // 방을 만든 쪽이 offer를 보내고, 두 채널이 모두 열릴 때까지 기다린다
  async connect(timeoutMs = 5000): Promise<void> {
    if (this.role === 'host') {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signal({ kind: 'offer', sdp: offer.sdp ?? '' });
    }
    await this.waitForChannels(timeoutMs);
    this.startRttProbe();
  }

  send(channel: Channel, data: Uint8Array): void {
    const ch = this.channels[channel];
    if (ch?.readyState === 'open') ch.send(data as Uint8Array<ArrayBuffer>); // 열리기 전이나 닫힌 뒤에는 조용히 버린다
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
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeSignal();
    this.pc.close();
    for (const fn of this.closeHandlers) fn();
  }

  private signal(data: SignalPayload): void {
    this.signaling.send({ t: 'signal', data }); // 서버는 내용을 보지 않고 상대에게 그대로 넘긴다
  }

  // 재협상 중에는 이전 협상의 answer/ice가 늦게 도착할 수 있으므로 상태에 맞지 않는 신호는 조용히 버린다.
  private async handleSignal(data: SignalPayload): Promise<void> {
    if (this.closed) return;
    try {
      switch (data.kind) {
        case 'offer': {
          // 참가한 쪽: offer를 받아 answer로 답한다
          if (this.role !== 'guest' || this.pc.signalingState !== 'stable') return;
          await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.signal({ kind: 'answer', sdp: answer.sdp ?? '' });
          return;
        }
        case 'answer':
          // 방을 만든 쪽: 내가 보낸 offer에 대한 답일 때만 받는다
          if (this.pc.signalingState !== 'have-local-offer') return;
          await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          return;
        case 'ice':
          if (!this.pc.remoteDescription) return; // 상대 설명을 받기 전의 후보는 붙일 수 없다
          await this.pc.addIceCandidate(data.candidate);
          return;
        case 'use_relay':
          return; // 릴레이 전환은 session.ts가 처리한다
      }
    } catch (err) {
      console.warn('[net] 신호 처리 무시:', (err as Error).message);
    }
  }

  // 채널에 수신 처리기를 붙이고 목록에 등록한다
  private attach(name: Channel, ch: RTCDataChannel): void {
    ch.binaryType = 'arraybuffer';
    ch.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      const bytes = new Uint8Array(ev.data);
      if (name === 'event' && this.handlePing(bytes)) return; // 핑은 게임에 넘기지 않는다
      for (const fn of this.messageHandlers) fn(name, bytes);
    };
    ch.onclose = () => this.close();
    this.channels[name] = ch;
  }

  // 50ms마다 두 채널이 열렸는지 본다. 시간이 넘으면 상태를 담아 실패 (릴레이로 내려갈 근거)
  private waitForChannels(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = performance.now() + timeoutMs;
      const tick = () => {
        if (this.closed) return reject(new Error('peer connection closed'));
        const input = this.channels.input;
        const event = this.channels.event;
        if (input?.readyState === 'open' && event?.readyState === 'open') return resolve();
        if (performance.now() > deadline) {
          return reject(
            new Error(
              `webrtc connect timeout (conn=${this.pc.connectionState} ice=${this.pc.iceConnectionState} sig=${this.pc.signalingState} input=${input?.readyState ?? 'none'} event=${event?.readyState ?? 'none'})`,
            ),
          );
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  // 핑 프레임: [0xF0, seq, t0(float64)] — event 채널에서만, 게임 패킷과 구분되도록 0xF0 접두
  private pingSeq = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  // 2초마다 보낸 시각을 담은 핑을 보낸다. 상대가 그대로 돌려주면 지금 시각과의 차가 RTT다
  private startRttProbe(): void {
    this.pingTimer = setInterval(() => {
      if (this.closed) return clearInterval(this.pingTimer);
      const buf = new Uint8Array(10);
      const v = new DataView(buf.buffer);
      v.setUint8(0, 0xf0);
      v.setUint8(1, this.pingSeq++ & 0xff);
      v.setFloat64(2, performance.now());
      this.send('event', buf);
    }, 2000);
  }

  // 핑(0xF0)이면 머리만 퐁(0xF1)으로 바꿔 되돌려 주고, 퐁이면 RTT를 계산한다. 둘 다 아니면 false
  private handlePing(bytes: Uint8Array): boolean {
    if (bytes.byteLength !== 10) return false;
    const tag = bytes[0];
    if (tag === 0xf0) {
      const reply = new Uint8Array(bytes);
      reply[0] = 0xf1;
      this.send('event', reply);
      return true;
    }
    if (tag === 0xf1) {
      const v = new DataView(bytes.buffer, bytes.byteOffset, 10);
      this.rtt = performance.now() - v.getFloat64(2); // 보낸 시각은 내 시계 기준이라 시계를 맞출 필요가 없다
      return true;
    }
    return false;
  }
}
