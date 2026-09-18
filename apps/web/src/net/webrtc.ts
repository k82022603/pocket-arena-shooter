import type { SignalPayload } from '@shooter/protocol';
import type { Channel, MessageHandler, Transport, Unsubscribe } from './transport';
import type { SignalingClient } from './signaling';

export type PeerRole = 'host' | 'guest';

const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export class WebRtcTransport implements Transport {
  readonly kind = 'webrtc' as const;
  rtt = 0;

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
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signal({ kind: 'ice', candidate: ev.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') this.close();
    };
    this.unsubscribeSignal = signaling.onMessage((msg) => {
      if (msg.t === 'signal') void this.handleSignal(msg.data);
    });

    if (role === 'host') {
      this.attach('input', this.pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 }));
      this.attach('event', this.pc.createDataChannel('event', { ordered: true }));
    } else {
      this.pc.ondatachannel = (ev) => this.attach(ev.channel.label as Channel, ev.channel);
    }
  }

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
    if (ch?.readyState === 'open') ch.send(data as Uint8Array<ArrayBuffer>);
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
    this.signaling.send({ t: 'signal', data });
  }

  // 재협상 중에는 이전 협상의 answer/ice가 늦게 도착할 수 있으므로 상태에 맞지 않는 신호는 조용히 버린다.
  private async handleSignal(data: SignalPayload): Promise<void> {
    if (this.closed) return;
    try {
      switch (data.kind) {
        case 'offer': {
          if (this.role !== 'guest' || this.pc.signalingState !== 'stable') return;
          await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.signal({ kind: 'answer', sdp: answer.sdp ?? '' });
          return;
        }
        case 'answer':
          if (this.pc.signalingState !== 'have-local-offer') return;
          await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          return;
        case 'ice':
          if (!this.pc.remoteDescription) return;
          await this.pc.addIceCandidate(data.candidate);
          return;
        case 'use_relay':
          return;
      }
    } catch (err) {
      console.warn('[net] 신호 처리 무시:', (err as Error).message);
    }
  }

  private attach(name: Channel, ch: RTCDataChannel): void {
    ch.binaryType = 'arraybuffer';
    ch.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      const bytes = new Uint8Array(ev.data);
      if (name === 'event' && this.handlePing(bytes)) return;
      for (const fn of this.messageHandlers) fn(name, bytes);
    };
    ch.onclose = () => this.close();
    this.channels[name] = ch;
  }

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
      this.rtt = performance.now() - v.getFloat64(2);
      return true;
    }
    return false;
  }
}
