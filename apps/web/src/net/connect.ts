import { SignalingClient } from './signaling';
import { SessionLink, negotiateTransport } from './session';

export type Session = SessionLink;

export async function hostSession(onCode: (code: string) => void): Promise<Session> {
  const signaling = new SignalingClient();
  const { code, token } = await signaling.createRoom();
  onCode(code);
  await signaling.waitFor('peer_joined', 10 * 60_000);
  const transport = await negotiateTransport(signaling, 'host', 5000);
  return new SessionLink('host', code, token, signaling, transport);
}

export async function joinSession(code: string): Promise<Session> {
  const signaling = new SignalingClient();
  const { token } = await signaling.joinRoom(code);
  const transport = await negotiateTransport(signaling, 'guest', 5000);
  return new SessionLink('guest', code, token, signaling, transport);
}
