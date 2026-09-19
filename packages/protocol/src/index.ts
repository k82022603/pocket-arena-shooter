// 브라우저와 시그널링 서버가 주고받는 JSON 메시지의 타입. 양쪽이 같은 파일을 불러와 형식이 어긋나지 않게 한다.

export type RoomCode = string; // 숫자 6자리
export type PeerRole = 'host' | 'guest';

// WebRTC 연결 후보 (브라우저의 RTCIceCandidateInit과 같은 모양)
export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload =
  | { kind: 'offer'; sdp: string } // 방을 만든 쪽의 연결 제안
  | { kind: 'answer'; sdp: string } // 참가한 쪽의 답
  | { kind: 'ice'; candidate: IceCandidate } // 연결 후보 주소
  // 한쪽이 WebRTC를 포기하고 릴레이로 내려갔으니 상대도 릴레이로 맞추라는 통지
  | { kind: 'use_relay' };

export type ClientToServer =
  | { t: 'create_room' } // 방을 만든다
  | { t: 'join_room'; code: RoomCode } // 코드로 들어간다
  // 끊긴 슬롯을 토큰으로 되찾는다. 이미 붙어 있는 소켓이 보내면 재협상 요청으로 취급한다.
  | { t: 'rejoin'; code: RoomCode; token: string }
  | { t: 'signal'; data: SignalPayload }; // 상대에게 넘겨 달라

export type ServerErrorCode = 'room_not_found' | 'room_full' | 'bad_token' | 'bad_message';

export type ServerToClient =
  | { t: 'room_created'; code: RoomCode; token: string } // 방이 생겼다 (코드와 내 재접속 토큰)
  | { t: 'room_joined'; code: RoomCode; token: string } // 방에 들어갔다
  | { t: 'rejoined'; code: RoomCode; role: PeerRole } // 자리를 되찾았다
  | { t: 'peer_joined' } // 상대가 새로 들어왔다
  // 상대 소켓이 끊겼지만 유예 시간 안에 돌아올 수 있다
  | { t: 'peer_disconnected' }
  | { t: 'peer_rejoined' } // 상대가 자리를 되찾았다
  // 상대가 유예 시간 안에 돌아오지 않았다 (최종)
  | { t: 'peer_left' }
  | { t: 'signal'; data: SignalPayload } // 상대가 보낸 협상 메시지
  | { t: 'error'; code: ServerErrorCode };

export const ROOM_CODE_LENGTH = 6;
// 서버가 끊긴 슬롯을 비워두는 시간. 클라이언트 재접속 창(10초)보다 넉넉해야 한다.
export const REJOIN_GRACE_MS = 15_000;
