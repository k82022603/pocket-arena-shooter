import type { PlayerState } from './types';

export interface HistoricalPose {
  x: number;
  y: number;
  dashTicks: number;
}

const SIZE = 64;

// 되감기 판정용 링 버퍼: 최근 SIZE 틱 동안의 플레이어 위치를 보관한다.
export class PositionHistory {
  private readonly ticks = new Int32Array(SIZE).fill(-1);
  private readonly poses: [HistoricalPose, HistoricalPose][] = Array.from({ length: SIZE }, () => [
    { x: 0, y: 0, dashTicks: 0 },
    { x: 0, y: 0, dashTicks: 0 },
  ]);
  private latest = -1;

  record(tick: number, players: readonly PlayerState[]): void {
    const slot = tick % SIZE;
    this.ticks[slot] = tick;
    for (const p of players) {
      const pose = this.poses[slot]![p.id];
      pose.x = p.x;
      pose.y = p.y;
      pose.dashTicks = p.dashTicks;
    }
    this.latest = tick;
  }

  lookup(id: 0 | 1, tick: number): HistoricalPose | null {
    if (this.latest < 0 || tick > this.latest) return null;
    const clamped = Math.max(tick, this.latest - SIZE + 1);
    const slot = clamped % SIZE;
    if (this.ticks[slot] !== clamped) return null;
    return this.poses[slot]![id];
  }
}
