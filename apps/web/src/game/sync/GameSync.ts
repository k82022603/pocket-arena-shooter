import type { Channel } from '../../net/transport';
import { SIM, type BulletState, type InputFrame, type PlayerState } from '../../sim/types';

// 게스트는 상대·탄환을 최신 스냅샷보다 이만큼 과거 시점으로 보간해 그린다 (60Hz 기준 100ms).
// 호스트는 게스트 탄환 판정을 되감을 때 같은 값을 더한다.
export const INTERP_DELAY_TICKS = 6;

// 라운드를 다시 시작해도 틱 번호가 이전 라운드보다 커야 지연 도착한 옛 패킷이 새 패킷을 가리지 않는다.
export function monotonicTick(): number {
  return Math.floor((performance.now() * SIM.tickRate) / 1000);
}

export interface RenderState {
  tick: number;
  players: readonly [PlayerState, PlayerState];
  bullets: readonly BulletState[];
}

export interface GameSync {
  readonly kind: 'solo' | 'host' | 'guest';
  readonly localId: 0 | 1;
  step(local: InputFrame): void;
  handleMessage(channel: Channel, bytes: Uint8Array): void;
  renderState(nowMs: number): RenderState;
  winner(): 0 | 1 | null;
  debugInfo(): string;
}
