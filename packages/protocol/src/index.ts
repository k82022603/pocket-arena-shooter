export type RoomCode = string;
export type PeerRole = 'host' | 'guest';

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: IceCandidate }
  // 한쪽이 WebRTC를 포기하고 릴레이로 내려갔으니 상대도 릴레이로 맞추라는 통지
  | { kind: 'use_relay' };

export type ClientToServer =
  | { t: 'create_room' }
  | { t: 'join_room'; code: RoomCode }
  // 끊긴 슬롯을 토큰으로 되찾는다. 이미 붙어 있는 소켓이 보내면 재협상 요청으로 취급한다.
  | { t: 'rejoin'; code: RoomCode; token: string }
  | { t: 'signal'; data: SignalPayload };

export type ServerErrorCode = 'room_not_found' | 'room_full' | 'bad_token' | 'bad_message';

export type ServerToClient =
  | { t: 'room_created'; code: RoomCode; token: string }
  | { t: 'room_joined'; code: RoomCode; token: string }
  | { t: 'rejoined'; code: RoomCode; role: PeerRole }
  | { t: 'peer_joined' }
  // 상대 소켓이 끊겼지만 유예 시간 안에 돌아올 수 있다
  | { t: 'peer_disconnected' }
  | { t: 'peer_rejoined' }
  // 상대가 유예 시간 안에 돌아오지 않았다 (최종)
  | { t: 'peer_left' }
  | { t: 'signal'; data: SignalPayload }
  | { t: 'error'; code: ServerErrorCode };

export const ROOM_CODE_LENGTH = 6;
// 서버가 끊긴 슬롯을 비워두는 시간. 클라이언트 재접속 창(10초)보다 넉넉해야 한다.
export const REJOIN_GRACE_MS = 15_000;
