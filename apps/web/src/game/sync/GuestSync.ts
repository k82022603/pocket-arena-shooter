import type { Channel } from '../../net/transport';
import { CHARACTERS, type CharacterId } from '../../sim/characters';
import {
  advanceBullet,
  applyPlayerInput,
  bulletHits,
  consumeFire,
  createInitialState,
  makeBullets,
  outcomeOf,
  setPlayerLoadout,
  summarize,
  type MatchSummary,
  type Outcome,
} from '../../sim/core';
import { INPUT_REDUNDANCY, decodeSnapshot, encodeCharacter, encodeInput, type Snapshot } from '../../sim/serialize';
import { ENEMIES, SIM, type BulletState, type EnemyState, type InputFrame, type PlayerState, type SimState } from '../../sim/types';
import { WEAPONS, type WeaponKind } from '../../sim/weapons';
import { INTERP_DELAY_TICKS, monotonicTick, type GameSync, type RenderState, type SyncLink } from './GameSync';

const MAX_SNAPSHOTS = 32;
const MAX_PENDING_INPUTS = 120;
// 호스트가 실시간보다 느리게 돌고 있는지 재는 창. 스냅샷 틱 진행량을 실제 경과 시간과 비교한다.
const HOST_RATE_WINDOW_MS = 1000;

// 보정 스무딩: 재조정으로 권위 위치가 예측과 달라도 화면에서는 즉시 순간이동하지 않는다.
// 시뮬레이션 상태(this.predicted)는 권위대로 덮고, 차이를 "화면 오프셋"으로 들고 있다가 지수 감쇠로 0에 수렴시킨다.
// 상태를 서버 쪽으로 천천히 끌어가는 방식과 달리, 판정에 쓰이는 위치는 항상 권위와 일치한다.
const CORRECTION_HALF_LIFE_MS = 70;
// 이보다 큰 어긋남은 부활·재접속·큰 디싱크이므로 미끄러뜨리지 않고 바로 붙인다.
const CORRECTION_SNAP_DISTANCE = 96;
// 오차가 계속 쌓이는 상황(지속 손실)에서도 화면이 실제 위치에서 이만큼 이상 떨어지지 않게 한다.
const CORRECTION_MAX_OFFSET = 48;
const CORRECTION_EPSILON = 0.25;

interface ReceivedSnapshot {
  state: SimState;
  receivedAt: number;
}

interface PendingInput {
  tick: number;
  frame: InputFrame;
}

interface PredictedBullet extends BulletState {
  // 대응하는 권위 탄환의 spawnTick. 입력 유실 시 호스트가 한두 틱 어긋난 입력으로 쏘므로 정확히 같지 않을 수 있다.
  authTick: number | null;
}

export class GuestSync implements GameSync {
  readonly kind = 'guest' as const;
  readonly localId = 1 as const;

  private localTick = monotonicTick();
  private pending: PendingInput[] = [];
  private predicted: PlayerState;
  private predictedBullets: PredictedBullet[] = [];
  private snapshots: ReceivedSnapshot[] = [];
  private readonly placeholder: SimState;
  private lastRender: RenderState | null = null;
  private corrections = 0;
  private rejectedShots = 0;
  // 화면 위치 = predicted + (smoothX, smoothY). 렌더 프레임마다 0으로 감쇠한다.
  private smoothX = 0;
  private smoothY = 0;
  private smoothedAt: number | null = null;
  private snaps = 0;
  // 호스트의 실제 진행 속도(틱/초). 60에 가까워야 정상이다.
  hostTickRate: number = SIM.tickRate;

  constructor(
    private readonly transport: SyncLink,
    private readonly local: CharacterId,
    private readonly weapon: WeaponKind,
    // 스냅샷 도착 시각의 출처. 테스트에서 가상 시계를 넣기 위해 주입 가능하게 둔다.
    private readonly now: () => number = () => performance.now(),
  ) {
    this.placeholder = createInitialState([local, local]);
    setPlayerLoadout(this.placeholder, this.localId, weapon);
    this.predicted = { ...this.placeholder.players[this.localId] };
    transport.send('event', encodeCharacter(local, weapon));
  }

  // 끊긴 동안의 스냅샷·입력은 버리고 호스트가 재전송하는 스냅샷부터 다시 맞춘다.
  resync(): void {
    this.snapshots.length = 0;
    this.pending.length = 0;
    this.predictedBullets = [];
    this.lastRender = null;
    this.clearCorrection();
    this.transport.send('event', encodeCharacter(this.local, this.weapon));
  }

  handleMessage(_channel: Channel, bytes: Uint8Array): void {
    const snapshot = decodeSnapshot(bytes);
    if (!snapshot) return;
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest && snapshot.state.tick <= latest.state.tick) return;
    this.snapshots.push({ state: snapshot.state, receivedAt: this.now() });
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    this.measureHostRate();
    this.reconcile(snapshot);
    this.reconcileBullets(snapshot);
  }

  // 호스트 프레임이 굶으면 호스트 시뮬레이션이 실시간보다 느려진다. 그러면 내 입력이 호스트 큐에서
  // 버려지고, 예측은 60틱/초로 달려가 스냅샷마다 크게 되돌아간다. 게스트 쪽에서 고칠 방법은 없으므로
  // 최소한 원인을 알 수 있도록 호스트의 실제 진행 속도를 재서 화면에 알린다.
  private measureHostRate(): void {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return;
    let oldest = latest;
    for (const s of this.snapshots) {
      if (latest.receivedAt - s.receivedAt <= HOST_RATE_WINDOW_MS) {
        oldest = s;
        break;
      }
    }
    const ms = latest.receivedAt - oldest.receivedAt;
    if (ms < HOST_RATE_WINDOW_MS / 2) return;
    this.hostTickRate = ((latest.state.tick - oldest.state.tick) * 1000) / ms;
  }

  private reconcile(snapshot: Snapshot): void {
    const authoritative = snapshot.state.players[this.localId];
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.tick <= snapshot.ackTick) drop += 1;
    this.pending.splice(0, drop);

    const replayed: PlayerState = { ...authoritative };
    for (const input of this.pending) {
      applyPlayerInput(replayed, input.frame);
      consumeFire(replayed, input.frame);
    }
    const error = Math.hypot(replayed.x - this.predicted.x, replayed.y - this.predicted.y);
    if (error > 0.5) this.corrections += 1;
    this.absorbCorrection(this.predicted, replayed, error);
    this.predicted = replayed;
  }

  // 화면이 이어져 보이도록 오프셋을 누적한다: 새 오프셋 = 이전 화면 위치 - 새 권위 위치.
  private absorbCorrection(before: PlayerState, after: PlayerState, error: number): void {
    if (error > CORRECTION_SNAP_DISTANCE) {
      this.snaps += 1;
      this.clearCorrection();
      return;
    }
    if (error <= CORRECTION_EPSILON) return;
    let x = this.smoothX + (before.x - after.x);
    let y = this.smoothY + (before.y - after.y);
    const len = Math.hypot(x, y);
    if (len > CORRECTION_MAX_OFFSET) {
      const k = CORRECTION_MAX_OFFSET / len;
      x *= k;
      y *= k;
    }
    this.smoothX = x;
    this.smoothY = y;
  }

  private clearCorrection(): void {
    this.smoothX = 0;
    this.smoothY = 0;
  }

  // 실제 경과 시간 기준 지수 감쇠. 프레임률이 달라도 같은 속도로 수렴한다.
  private decayCorrection(nowMs: number): void {
    const last = this.smoothedAt;
    this.smoothedAt = nowMs;
    if (this.smoothX === 0 && this.smoothY === 0) return;
    const dt = last === null ? 0 : Math.max(nowMs - last, 0);
    const keep = Math.pow(0.5, dt / CORRECTION_HALF_LIFE_MS);
    this.smoothX *= keep;
    this.smoothY *= keep;
    if (Math.hypot(this.smoothX, this.smoothY) < CORRECTION_EPSILON) this.clearCorrection();
  }

  // 그릴 때만 오프셋을 더한다. 탄환 생성·판정은 this.predicted(권위 일치)를 그대로 쓴다.
  private localView(): PlayerState {
    if (this.smoothX === 0 && this.smoothY === 0) return this.predicted;
    return { ...this.predicted, x: this.predicted.x + this.smoothX, y: this.predicted.y + this.smoothY };
  }

  // 호스트가 처리한 입력(ack 이하)으로 생긴 예측 탄환은 권위 스냅샷에 있어야 한다.
  // 없으면 거부됐거나(쿨다운 불일치) 이미 명중·소멸한 것이므로 지운다.
  private reconcileBullets(snapshot: Snapshot): void {
    const tolerance = Math.floor(CHARACTERS[this.predicted.character].stats.fireIntervalTicks / 2);
    const mine: number[] = [];
    for (const b of snapshot.state.bullets) if (b.owner === this.localId) mine.push(b.spawnTick);
    const used = new Set<number>();
    for (const b of this.predictedBullets) if (b.authTick !== null && mine.includes(b.authTick)) used.add(b.authTick);

    const nearest = (tick: number): number | null => {
      let best: number | null = null;
      for (const s of mine) {
        if (used.has(s)) continue;
        if (best === null || Math.abs(s - tick) < Math.abs(best - tick)) best = s;
      }
      return best !== null && Math.abs(best - tick) <= tolerance ? best : null;
    };

    this.predictedBullets = this.predictedBullets.filter((b) => {
      if (b.authTick !== null) return mine.includes(b.authTick);
      if (b.spawnTick > snapshot.ackTick + tolerance) return true;
      const match = nearest(b.spawnTick);
      if (match !== null) {
        b.authTick = match;
        used.add(match);
        return true;
      }
      if (b.spawnTick + tolerance <= snapshot.ackTick) {
        this.rejectedShots += 1;
        return false;
      }
      return true;
    });
  }

  step(local: InputFrame): void {
    this.localTick += 1;
    this.pending.push({ tick: this.localTick, frame: local });
    if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
    const recent = this.pending.slice(-INPUT_REDUNDANCY).reverse().map((p) => p.frame);
    this.transport.send('input', encodeInput(this.localTick, recent));

    applyPlayerInput(this.predicted, local);
    if (consumeFire(this.predicted, local)) {
      // 예측 탄환 id는 음수로 두어 권위 탄환 id와 겹치지 않게 한다 (산탄은 여러 발).
      for (const b of makeBullets(this.predicted, -this.localTick * 8 - 7, this.localTick, 0)) {
        this.predictedBullets.push({ ...b, authTick: null });
      }
    }

    const render = this.lastRender;
    this.predictedBullets = this.predictedBullets.filter((b) => {
      if (!advanceBullet(b)) return false;
      // 호스트가 되감기로 같은 시점을 판정하므로, 화면상 명중이면 미리 지운다 (관통탄은 계속 날아간다).
      return WEAPONS[b.kind].pierce || !(render && this.visuallyHits(b, render));
    });
  }

  private visuallyHits(b: BulletState, render: RenderState): boolean {
    if (render.mode === 'coop') {
      return render.coop?.enemies.some((e) => bulletHits(b, e.x, e.y, ENEMIES[e.kind].radius)) ?? false;
    }
    const remote = render.players[0];
    return remote.hp > 0 && remote.dashTicks === 0 && bulletHits(b, remote.x, remote.y);
  }

  renderState(nowMs: number): RenderState {
    this.decayCorrection(nowMs);
    const localView = this.localView();
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) {
      const players: [PlayerState, PlayerState] = [this.placeholder.players[0], localView];
      return { ...this.placeholder, tick: this.localTick, players, bullets: this.predictedBullets, pickups: [] };
    }

    const estimatedHostTick = latest.state.tick + ((nowMs - latest.receivedAt) * SIM.tickRate) / 1000;
    const renderTick = estimatedHostTick - INTERP_DELAY_TICKS;
    const [from, to] = this.bracket(renderTick);
    const span = to.state.tick - from.state.tick;
    const t = span > 0 ? clamp01((renderTick - from.state.tick) / span) : 1;

    const remote = lerpPlayer(from.state.players[0], to.state.players[0], t);
    const players: [PlayerState, PlayerState] = [remote, localView];

    const predictedTicks = new Set<number>();
    for (const b of this.predictedBullets) predictedTicks.add(b.authTick ?? b.spawnTick);

    const fromBullets = new Map<number, BulletState>();
    for (const b of from.state.bullets) fromBullets.set(b.id, b);
    const bullets: BulletState[] = [];
    for (const b of to.state.bullets) {
      if (b.owner === this.localId && predictedTicks.has(b.spawnTick)) continue;
      const prev = fromBullets.get(b.id);
      bullets.push(prev ? { ...b, x: lerp(prev.x, b.x, t), y: lerp(prev.y, b.y, t) } : b);
    }
    for (const b of this.predictedBullets) bullets.push(b);

    let coop = to.state.coop;
    if (coop && from.state.coop) {
      const fromEnemies = new Map<number, EnemyState>();
      for (const e of from.state.coop.enemies) fromEnemies.set(e.id, e);
      coop = {
        ...coop,
        enemies: coop.enemies.map((e) => {
          const prev = fromEnemies.get(e.id);
          return prev ? { ...e, x: lerp(prev.x, e.x, t), y: lerp(prev.y, e.y, t) } : e;
        }),
      };
    }

    const render: RenderState = {
      tick: latest.state.tick,
      mode: to.state.mode,
      playerCount: to.state.playerCount,
      players,
      bullets,
      pickups: to.state.pickups,
      coop,
    };
    this.lastRender = render;
    return render;
  }

  private bracket(renderTick: number): [ReceivedSnapshot, ReceivedSnapshot] {
    let from = this.snapshots[0]!;
    let to = this.snapshots[this.snapshots.length - 1]!;
    for (const s of this.snapshots) {
      if (s.state.tick <= renderTick) from = s;
      if (s.state.tick >= renderTick) {
        to = s;
        break;
      }
    }
    return [from, to];
  }

  outcome(): Outcome | null {
    const latest = this.snapshots[this.snapshots.length - 1];
    return latest ? outcomeOf(latest.state) : null;
  }

  summary(): MatchSummary | null {
    const latest = this.snapshots[this.snapshots.length - 1];
    return latest ? summarize(latest.state) : null;
  }

  debugInfo(): string {
    const off = Math.hypot(this.smoothX, this.smoothY);
    return `host ${this.hostTickRate.toFixed(0)}t/s snap ${this.snapshots.length} pending ${this.pending.length} fix ${this.corrections} smooth ${off.toFixed(1)}px snapped ${this.snaps} shots ${this.predictedBullets.length} rejected ${this.rejectedShots}`;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerpPlayer(a: PlayerState, b: PlayerState, t: number): PlayerState {
  return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), aimAngle: lerpAngle(a.aimAngle, b.aimAngle, t) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
