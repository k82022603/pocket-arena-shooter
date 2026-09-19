import type { EnemyState, PlayerState } from './types';

// 되감기 판정(lag compensation)용 위치 기록. 호스트만 쓴다.
// 참가한 쪽은 과거의 화면을 보고 쏘므로, 그 탄을 판정할 때 표적을 그 시점 위치로 되돌려 본다.

export interface HistoricalPose {
  x: number;
  y: number;
  dashTicks: number; // 그 시점에 대시(무적) 중이었는가
}

export interface EnemyPose {
  x: number;
  y: number;
}

const SIZE = 64; // 보관하는 틱 수 (약 1초). 되감기 상한(대전 12틱, 협동 24틱)보다 넉넉하다
// 한 틱에 기록할 적 상한. 가장 큰 편성(웨이브 10)이 31기라 여유가 충분하다.
const MAX_ENEMIES = 64;

// 되감기 판정용 링 버퍼: 최근 SIZE 틱 동안의 플레이어 위치를 보관한다.
// 칸 번호 = tick % SIZE. 오래된 칸은 새 틱이 덮어쓴다. 할당 없이 도는 고정 배열이다
export class PositionHistory {
  private readonly ticks = new Int32Array(SIZE).fill(-1); // 칸마다 어느 틱의 기록인지 (-1이면 빈칸)
  private readonly poses: [HistoricalPose, HistoricalPose][] = Array.from({ length: SIZE }, () => [
    { x: 0, y: 0, dashTicks: 0 },
    { x: 0, y: 0, dashTicks: 0 },
  ]);
  private latest = -1; // 가장 최근에 기록한 틱
  // 적은 수가 매번 달라서 칸마다 MAX_ENEMIES 자리를 잡아 두고 앞에서부터 채운다
  private readonly enemyTicks = new Int32Array(SIZE).fill(-1);
  private readonly enemyCounts = new Int32Array(SIZE); // 칸마다 실제로 채운 적 수
  private readonly enemyIds = new Int32Array(SIZE * MAX_ENEMIES);
  private readonly enemyXs = new Float32Array(SIZE * MAX_ENEMIES);
  private readonly enemyYs = new Float32Array(SIZE * MAX_ENEMIES);
  private enemyLatest = -1;

  // 이번 틱의 두 플레이어 위치를 적는다
  record(tick: number, players: readonly PlayerState[]): void {
    const slot = tick % SIZE;
    this.ticks[slot] = tick;
    for (const p of players) {
      const pose = this.poses[slot]![p.id]; // 객체를 새로 만들지 않고 값만 덮어쓴다
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
    const base = slot * MAX_ENEMIES; // 이 칸이 시작하는 배열 위치
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
    if (this.enemyLatest < 0 || tick > this.enemyLatest) return null; // 미래는 모른다
    const clamped = Math.max(tick, this.enemyLatest - SIZE + 1); // 버퍼보다 오래됐으면 가장 오래된 기록으로
    const slot = clamped % SIZE;
    if (this.enemyTicks[slot] !== clamped) return null; // 그 칸이 다른 틱으로 덮였다
    const base = slot * MAX_ENEMIES;
    const n = this.enemyCounts[slot]!;
    for (let i = 0; i < n; i++) {
      if (this.enemyIds[base + i] === id) return { x: this.enemyXs[base + i]!, y: this.enemyYs[base + i]! };
    }
    return null;
  }

  // 그 틱의 플레이어 위치. 없으면 null
  lookup(id: 0 | 1, tick: number): HistoricalPose | null {
    if (this.latest < 0 || tick > this.latest) return null;
    const clamped = Math.max(tick, this.latest - SIZE + 1);
    const slot = clamped % SIZE;
    if (this.ticks[slot] !== clamped) return null;
    return this.poses[slot]![id];
  }
}
