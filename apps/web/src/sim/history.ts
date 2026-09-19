import type { EnemyState, PlayerState } from './types';

export interface HistoricalPose {
  x: number;
  y: number;
  dashTicks: number;
}

export interface EnemyPose {
  x: number;
  y: number;
}

const SIZE = 64;
// 한 틱에 기록할 적 상한. 가장 큰 편성(웨이브 10)이 31기라 여유가 충분하다.
const MAX_ENEMIES = 64;

// 되감기 판정용 링 버퍼: 최근 SIZE 틱 동안의 플레이어 위치를 보관한다.
export class PositionHistory {
  private readonly ticks = new Int32Array(SIZE).fill(-1);
  private readonly poses: [HistoricalPose, HistoricalPose][] = Array.from({ length: SIZE }, () => [
    { x: 0, y: 0, dashTicks: 0 },
    { x: 0, y: 0, dashTicks: 0 },
  ]);
  private latest = -1;
  private readonly enemyTicks = new Int32Array(SIZE).fill(-1);
  private readonly enemyCounts = new Int32Array(SIZE);
  private readonly enemyIds = new Int32Array(SIZE * MAX_ENEMIES);
  private readonly enemyXs = new Float32Array(SIZE * MAX_ENEMIES);
  private readonly enemyYs = new Float32Array(SIZE * MAX_ENEMIES);
  private enemyLatest = -1;

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

  // 적 위치는 "그 틱의 탄환 판정이 본 위치"로 기록한다.
  // stepCoop이 stepBullets 뒤에 돌아서 배열에 담긴 값은 직전 틱이 끝난 시점의 위치지만,
  // 판정 프레임을 기준으로 라벨을 붙여 두면 플레이어와 똑같이 tick - lagTicks로 조회할 수 있다.
  // 적은 수가 변하고 id도 웨이브마다 새로 발급되므로 고정 길이 배열에 id를 함께 적어 둔다.
  recordEnemies(tick: number, enemies: readonly EnemyState[]): void {
    const slot = tick % SIZE;
    const n = Math.min(enemies.length, MAX_ENEMIES);
    const base = slot * MAX_ENEMIES;
    for (let i = 0; i < n; i++) {
      const e = enemies[i]!;
      this.enemyIds[base + i] = e.id;
      this.enemyXs[base + i] = e.x;
      this.enemyYs[base + i] = e.y;
    }
    this.enemyTicks[slot] = tick;
    this.enemyCounts[slot] = n;
    this.enemyLatest = tick;
  }

  // 그 틱에 없던 적이면 null. 호출자는 현재 위치로 판정한다.
  lookupEnemy(id: number, tick: number): EnemyPose | null {
    if (this.enemyLatest < 0 || tick > this.enemyLatest) return null;
    const clamped = Math.max(tick, this.enemyLatest - SIZE + 1);
    const slot = clamped % SIZE;
    if (this.enemyTicks[slot] !== clamped) return null;
    const base = slot * MAX_ENEMIES;
    const n = this.enemyCounts[slot]!;
    for (let i = 0; i < n; i++) {
      if (this.enemyIds[base + i] === id) return { x: this.enemyXs[base + i]!, y: this.enemyYs[base + i]! };
    }
    return null;
  }

  lookup(id: 0 | 1, tick: number): HistoricalPose | null {
    if (this.latest < 0 || tick > this.latest) return null;
    const clamped = Math.max(tick, this.latest - SIZE + 1);
    const slot = clamped % SIZE;
    if (this.ticks[slot] !== clamped) return null;
    return this.poses[slot]![id];
  }
}
