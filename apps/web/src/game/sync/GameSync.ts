import type { Channel } from '../../net/transport';
import { SIM, type BulletState, type InputFrame, type PlayerState } from '../../sim/types';

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
