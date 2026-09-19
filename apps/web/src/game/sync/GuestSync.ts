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

// 참가한 쪽(게스트): 권위가 없다. 지연을 감추려고 내 캐릭터는 예측하고, 나머지는 과거 스냅샷 사이를 보간해 그린다.
// 예측 → 스냅샷 도착 → 재조정(확인 안 된 입력만 다시 적용) → 차이는 화면 오프셋으로 부드럽게 흡수.

const MAX_SNAPSHOTS = 32; // 보간용으로 들고 있는 스냅샷 수 (약 1.6초)
const MAX_PENDING_INPUTS = 120; // 호스트가 아직 확인하지 않은 내 입력 보관 상한 (2초)
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
const CORRECTION_EPSILON = 0.25; // 이보다 작은 오프셋은 0으로 본다 (px)

interface ReceivedSnapshot {
  state: SimState;
  receivedAt: number; // 도착 시각 (호스트 틱을 실제 시간으로 어림하는 기준)
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

  private localTick = monotonicTick(); // 내 입력에 붙이는 틱 번호
  private pending: PendingInput[] = []; // 보냈지만 호스트가 아직 적용했다고 확인하지 않은 입력
  private predicted: PlayerState; // 내 캐릭터의 예측 상태 (판정과 탄 생성의 기준)
  private predictedBullets: PredictedBullet[] = []; // 내가 쏜 것으로 예측한 탄 (응답을 기다리지 않고 바로 그린다)
  private snapshots: ReceivedSnapshot[] = []; // 받은 스냅샷 (틱 오름차순)
  private readonly placeholder: SimState; // 첫 스냅샷 전 임시 상태
  private lastRender: RenderState | null = null; // 직전에 그린 상태 (예측 탄의 화면 명중 판정용)
  private corrections = 0; // 재조정으로 위치가 달라진 횟수 (진단용)
  private rejectedShots = 0; // 호스트가 인정하지 않아 지운 예측 탄 수 (진단용)
  // 화면 위치 = predicted + (smoothX, smoothY). 렌더 프레임마다 0으로 감쇠한다.
  private smoothX = 0;
  private smoothY = 0;
  private smoothedAt: number | null = null; // 마지막으로 감쇠한 시각 (null이면 아직 없음)
  private snaps = 0; // 너무 커서 미끄러뜨리지 않고 바로 붙인 횟수
  // 호스트의 실제 진행 속도(틱/초). 60에 가까워야 정상이다.
  hostTickRate: number = SIM.tickRate;
  /** 권위 스냅샷을 한 장이라도 받았는가. 받기 전에 그리는 화면은 임시 초기값이라 진짜가 아니다. */
  get hasAuthority(): boolean {
    return this.snapshots.length > 0;
  }


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
    transport.send('event', encodeCharacter(local, weapon)); // 내가 고른 것을 호스트에 알린다
  }

  // 끊긴 동안의 스냅샷·입력은 버리고 호스트가 재전송하는 스냅샷부터 다시 맞춘다.
  // 게스트는 시뮬레이션을 돌리지 않으므로 낼 사건이 없다. 피해 주체는 호스트 기록에만 남는다.
  setEventSink(): void {}

  resync(): void {
    this.snapshots.length = 0;
    this.pending.length = 0;
    this.predictedBullets = [];
    this.lastRender = null;
    this.clearCorrection();
    this.transport.send('event', encodeCharacter(this.local, this.weapon));
  }

  handleMessage(_channel: Channel, bytes: Uint8Array): void {
    const snapshot = decodeSnapshot(bytes); // 게스트가 받는 게임 패킷은 스냅샷뿐이다 (캐릭터는 스냅샷에 실려 온다)
    if (!snapshot) return;
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest && snapshot.state.tick <= latest.state.tick) return; // 순서가 뒤바뀌어 늦게 온 옛 스냅샷은 버린다
    this.snapshots.push({ state: snapshot.state, receivedAt: this.now() });
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift(); // 가장 오래된 것부터 버린다
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
    // 창(1초) 안에서 가장 오래된 스냅샷을 찾는다
    let oldest = latest;
    for (const s of this.snapshots) {
      if (latest.receivedAt - s.receivedAt <= HOST_RATE_WINDOW_MS) {
        oldest = s;
        break;
      }
    }
    const ms = latest.receivedAt - oldest.receivedAt;
    if (ms < HOST_RATE_WINDOW_MS / 2) return; // 표본 구간이 너무 짧으면 재지 않는다
    this.hostTickRate = ((latest.state.tick - oldest.state.tick) * 1000) / ms; // 진행한 틱 ÷ 실제 초
  }

  // 재조정: 스냅샷의 내 위치(권위)에서 시작해, 호스트가 아직 적용하지 않은 내 입력만 다시 적용한다
  private reconcile(snapshot: Snapshot): void {
    const authoritative = snapshot.state.players[this.localId];
    // 호스트가 적용했다고 확인한(ackTick 이하) 입력은 더 들고 있을 필요가 없다
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.tick <= snapshot.ackTick) drop += 1;
    this.pending.splice(0, drop);

    const replayed: PlayerState = { ...authoritative };
    for (const input of this.pending) {
      // 이동과 쿨다운을 다시 굴린다. 탄은 이미 예측해서 쐈으므로 다시 만들지 않는다
      applyPlayerInput(replayed, input.frame);
      consumeFire(replayed, input.frame);
    }
    const error = Math.hypot(replayed.x - this.predicted.x, replayed.y - this.predicted.y); // 예측이 얼마나 틀렸는가
    if (error > 0.5) this.corrections += 1;
    this.absorbCorrection(this.predicted, replayed, error);
    this.predicted = replayed; // 상태는 권위대로 덮는다 (화면만 오프셋으로 이어 붙인다)
  }

  // 화면이 이어져 보이도록 오프셋을 누적한다: 새 오프셋 = 이전 화면 위치 - 새 권위 위치.
  private absorbCorrection(before: PlayerState, after: PlayerState, error: number): void {
    if (error > CORRECTION_SNAP_DISTANCE) {
      this.snaps += 1;
      this.clearCorrection();
      return;
    }
    if (error <= CORRECTION_EPSILON) return;
    // 기존 오프셋에 이번 차이를 더한다. 그래야 화면 위치(상태 + 오프셋)가 이 순간 끊기지 않는다
    let x = this.smoothX + (before.x - after.x);
    let y = this.smoothY + (before.y - after.y);
    const len = Math.hypot(x, y);
    if (len > CORRECTION_MAX_OFFSET) {
      // 방향은 두고 길이만 상한으로 줄인다
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
    const keep = Math.pow(0.5, dt / CORRECTION_HALF_LIFE_MS); // 반감기 70ms: 70ms마다 절반씩 남는다
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
    // 호스트는 입력 유실 때 한두 틱 어긋난 입력으로 쏠 수 있어서, 연사 간격의 절반까지는 같은 탄으로 본다
    const tolerance = Math.floor(CHARACTERS[this.predicted.character].stats.fireIntervalTicks / 2);
    const mine: number[] = []; // 스냅샷에 있는 내 탄들의 spawnTick
    for (const b of snapshot.state.bullets) if (b.owner === this.localId) mine.push(b.spawnTick);
    const used = new Set<number>(); // 이미 어떤 예측 탄과 짝지어진 권위 탄 (한 번만 짝짓는다)
    for (const b of this.predictedBullets) if (b.authTick !== null && mine.includes(b.authTick)) used.add(b.authTick);

    // 아직 짝이 없는 권위 탄 중 spawnTick이 가장 가까운 것 (허용 범위 안에서)
    const nearest = (tick: number): number | null => {
      let best: number | null = null;
      for (const s of mine) {
        if (used.has(s)) continue;
        if (best === null || Math.abs(s - tick) < Math.abs(best - tick)) best = s;
      }
      return best !== null && Math.abs(best - tick) <= tolerance ? best : null;
    };

    this.predictedBullets = this.predictedBullets.filter((b) => {
      if (b.authTick !== null) return mine.includes(b.authTick); // 짝이 스냅샷에서 사라졌으면(명중·소멸) 같이 지운다
      if (b.spawnTick > snapshot.ackTick + tolerance) return true; // 호스트가 아직 그 입력까지 못 갔다: 기다린다
      const match = nearest(b.spawnTick);
      if (match !== null) {
        b.authTick = match;
        used.add(match);
        return true;
      }
      if (b.spawnTick + tolerance <= snapshot.ackTick) {
        // 호스트가 그 입력을 처리했는데 대응하는 탄이 없다: 쏘지 않은 것으로 판정됐다
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
    // 최근 입력 3개를 최신부터 담아 보낸다. 한 패킷을 잃어도 다음 패킷이 메운다
    const recent = this.pending.slice(-INPUT_REDUNDANCY).reverse().map((p) => p.frame);
    this.transport.send('input', encodeInput(this.localTick, recent));

    // 예측: 호스트 응답을 기다리지 않고 내 캐릭터를 바로 움직인다 (체감 지연 0)
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

  // 내 화면에 보이는 표적과 겹치는가 (협동이면 적들, 대전이면 상대)
  private visuallyHits(b: BulletState, render: RenderState): boolean {
    if (render.mode === 'coop') {
      return render.coop?.enemies.some((e) => bulletHits(b, e.x, e.y, ENEMIES[e.kind].radius)) ?? false;
    }
    const remote = render.players[0]; // 게스트의 상대는 늘 0번 (호스트)
    return remote.hp > 0 && remote.dashTicks === 0 && bulletHits(b, remote.x, remote.y);
  }

  renderState(nowMs: number): RenderState {
    this.decayCorrection(nowMs);
    const localView = this.localView();
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) {
      // 첫 스냅샷 전: 임시 상태에 내 예측만 얹어 그린다 (ArenaScene은 이 동안 대기 안내를 띄운다)
      const players: [PlayerState, PlayerState] = [this.placeholder.players[0], localView];
      return { ...this.placeholder, tick: this.localTick, players, bullets: this.predictedBullets, pickups: [] };
    }

    // 지금 호스트가 몇 틱쯤일지 어림하고, 그보다 100ms 과거를 그린다. 그 시점을 감싸는 두 스냅샷 사이를 잇는다
    const estimatedHostTick = latest.state.tick + ((nowMs - latest.receivedAt) * SIM.tickRate) / 1000;
    const renderTick = estimatedHostTick - INTERP_DELAY_TICKS;
    const [from, to] = this.bracket(renderTick);
    const span = to.state.tick - from.state.tick;
    const t = span > 0 ? clamp01((renderTick - from.state.tick) / span) : 1; // 두 스냅샷 사이 비율 (0..1)

    const remote = lerpPlayer(from.state.players[0], to.state.players[0], t); // 상대는 보간
    const players: [PlayerState, PlayerState] = [remote, localView]; // 나는 예측(+보정 오프셋)

    // 이미 예측 탄으로 그리고 있는 내 탄은 권위 탄을 또 그리지 않는다 (같은 탄이 두 개로 보이지 않게)
    const predictedTicks = new Set<number>();
    for (const b of this.predictedBullets) predictedTicks.add(b.authTick ?? b.spawnTick);

    const fromBullets = new Map<number, BulletState>();
    for (const b of from.state.bullets) fromBullets.set(b.id, b);
    const bullets: BulletState[] = [];
    for (const b of to.state.bullets) {
      if (b.owner === this.localId && predictedTicks.has(b.spawnTick)) continue;
      const prev = fromBullets.get(b.id);
      bullets.push(prev ? { ...b, x: lerp(prev.x, b.x, t), y: lerp(prev.y, b.y, t) } : b); // 두 스냅샷에 다 있으면 보간, 새로 생긴 탄이면 그대로
    }
    for (const b of this.predictedBullets) bullets.push(b);

    // 협동의 적도 같은 방식으로 보간한다 (id로 짝짓는다)
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

  // renderTick을 사이에 둔 두 스냅샷. 범위 밖이면 가장 가까운 끝을 쓴다
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
    return latest ? outcomeOf(latest.state) : null; // 승패는 호스트가 보낸 최신 상태로 판단한다
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

// 각도 보간: 차이를 -π..π로 돌려 짧은 쪽으로 돈다 (179도에서 -179도로 한 바퀴 돌지 않게)
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
