import { SignalingClient } from './signaling';
import { WebRtcTransport, type PeerRole } from './webrtc';
import { RelayTransport } from './relay';
import { SimulatedTransport, netSimFromUrl } from './simulated';
import type { Transport } from './transport';

export interface Session {
  role: PeerRole;
  code: string;
  signaling: SignalingClient;
  transport: Transport;
}

export async function hostSession(onCode: (code: string) => void): Promise<Session> {
  const signaling = new SignalingClient();
  const code = await signaling.createRoom();
  onCode(code);
  await signaling.waitFor('peer_joined', 10 * 60_000);
  const transport = await connectWithFallback(signaling, 'host');
  return { role: 'host', code, signaling, transport };
}

export async function joinSession(code: string): Promise<Session> {
  const signaling = new SignalingClient();
  await signaling.joinRoom(code);
  const transport = await connectWithFallback(signaling, 'guest');
  return { role: 'guest', code, signaling, transport };
}

async function connectWithFallback(signaling: SignalingClient, role: PeerRole): Promise<Transport> {
  const rtc = new WebRtcTransport(signaling, role);
  let transport: Transport;
  try {
    await rtc.connect(5000);
    transport = rtc;
  } catch {
    rtc.close();
    transport = new RelayTransport(signaling);
  }
  const sim = netSimFromUrl();
  return sim ? new SimulatedTransport(transport, sim) : transport;
}
