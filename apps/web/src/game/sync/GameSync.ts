import type { Channel } from '../../net/transport';
import type { MatchSummary, Outcome } from '../../sim/core';
import { SIM, type InputFrame, type SimState } from '../../sim/types';
import type { SimEventSink } from '../../sim/events';

// 게임 방식(혼자·방을 만든 쪽·참가한 쪽)마다 구현이 다르다. ArenaScene은 이 인터페이스만 본다.

// 화면을 그리는 데 필요한 상태만 골라낸 형태
export type RenderState = Pick<SimState, 'tick' | 'mode' | 'playerCount' | 'players' | 'bullets' | 'pickups' | 'coop'>;

export interface GameSync {
  readonly kind: 'solo' | 'host' | 'guest';
  readonly localId: 0 | 1; // 이 기기가 조종하는 플레이어 번호
  step(local: InputFrame): void; // 내 입력으로 한 틱 진행
  handleMessage(channel: Channel, bytes: Uint8Array): void; // 상대가 보낸 패킷 처리
  renderState(nowMs: number): RenderState; // 지금 그릴 상태 (참가한 쪽은 보간·보정이 들어간다)
  outcome(): Outcome | null; // 끝났으면 결과
  summary(): MatchSummary | null; // 결과 화면 통계
  // 재접속 직후: 버퍼를 비우고 상대에게 필요한 상태(캐릭터, 스냅샷)를 다시 보낸다.
  resync(): void;
  debugInfo(): string; // ?debug=1 진단 줄과 경기 기록에 쓰는 한 줄
  // 시뮬레이션을 직접 돌리는 쪽(솔로·호스트)만 피해 주체 같은 사건을 낸다. 게스트는 무시한다.
  setEventSink(sink: SimEventSink | null): void;
}

// 동기화 구현이 네트워크에 요구하는 최소한. 검사에서는 가짜 링크를 끼운다
export interface SyncLink {
  readonly rtt: number;
  send(channel: Channel, data: Uint8Array): void;
}

// 게스트는 상대·탄환을 최신 스냅샷보다 이만큼 과거 시점으로 보간해 그린다 (60Hz 기준 100ms).
// 호스트는 게스트 탄환 판정을 되감을 때 같은 값을 더한다.
export const INTERP_DELAY_TICKS = 6;

// 라운드를 다시 시작해도 틱 번호가 이전 라운드보다 커야 지연 도착한 옛 패킷이 새 패킷을 가리지 않는다.
export function monotonicTick(): number {
  return Math.floor((performance.now() * SIM.tickRate) / 1000); // 페이지를 연 뒤 흐른 시간을 틱으로
}
