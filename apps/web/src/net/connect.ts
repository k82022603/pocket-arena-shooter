import { SignalingClient } from './signaling';
import { SessionLink, negotiateTransport } from './session';

// 로비가 부르는 두 진입점: 방 만들기와 참가하기. 둘 다 연결된 세션을 돌려준다.

export type Session = SessionLink;

// 방을 만들고 코드를 알린 뒤, 상대가 들어오면 전송로를 협상한다
export async function hostSession(onCode: (code: string) => void): Promise<Session> {
  const signaling = new SignalingClient();
  const { code, token } = await signaling.createRoom();
  onCode(code); // 로비가 QR과 6자리 코드를 띄운다
  await signaling.waitFor('peer_joined', 10 * 60_000); // 상대를 최대 10분 기다린다
  const transport = await negotiateTransport(signaling, 'host', 5000); // P2P 5초 시도, 안 되면 릴레이
  return new SessionLink('host', code, token, signaling, transport);
}

// 코드로 방에 들어가 전송로를 협상한다
export async function joinSession(code: string): Promise<Session> {
  const signaling = new SignalingClient();
  const { token } = await signaling.joinRoom(code); // 재접속할 때 쓸 토큰을 받아 둔다
  const transport = await negotiateTransport(signaling, 'guest', 5000);
  return new SessionLink('guest', code, token, signaling, transport);
}
