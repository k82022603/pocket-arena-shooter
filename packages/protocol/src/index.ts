export type RoomCode = string;

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: IceCandidate };

export type ClientToServer =
  | { t: 'create_room' }
  | { t: 'join_room'; code: RoomCode }
  | { t: 'signal'; data: SignalPayload };

export type ServerErrorCode = 'room_not_found' | 'room_full' | 'bad_message';

export type ServerToClient =
  | { t: 'room_created'; code: RoomCode }
  | { t: 'room_joined'; code: RoomCode }
  | { t: 'peer_joined' }
  | { t: 'peer_left' }
  | { t: 'signal'; data: SignalPayload }
  | { t: 'error'; code: ServerErrorCode };

export const ROOM_CODE_LENGTH = 6;
