// 전송 계층의 공통 인터페이스. WebRTC든 WebSocket 릴레이든 게임 코드는 이것만 본다(교체 지점).

// input: 순서·재전송 없이 지연 우선 (입력, 스냅샷). 잃어도 다음 것이 덮는다
// event: 순서 보장·신뢰 우선 (캐릭터 선택, 재경기 신호). 잃으면 안 되는 것
export type Channel = 'input' | 'event';

export type MessageHandler = (channel: Channel, data: Uint8Array) => void;
export type Unsubscribe = () => void; // 등록한 처리기를 떼는 함수

export interface Transport {
  readonly kind: 'webrtc' | 'relay'; // 어떤 경로로 붙었는가 (화면·기록 표시용)
  readonly rtt: number; // 왕복 지연 (ms). 모르면 0
  send(channel: Channel, data: Uint8Array): void;
  onMessage(handler: MessageHandler): Unsubscribe;
  onClose(handler: () => void): Unsubscribe;
  close(): void;
}
