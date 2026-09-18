import type { Channel, Transport } from '../../net/transport';
import { CHARACTERS, type CharacterId } from '../../sim/characters';
import { advanceBullet, applyPlayerInput, bulletHits, consumeFire, createInitialState, makeBullet, winnerOf } from '../../sim/core';
import { INPUT_REDUNDANCY, decodeSnapshot, encodeCharacter, encodeInput, type Snapshot } from '../../sim/serialize';
import { SIM, type BulletState, type InputFrame, type PlayerState, type SimState } from '../../sim/types';
import { INTERP_DELAY_TICKS, monotonicTick, type GameSync, type RenderState } from './GameSync';

const MAX_SNAPSHOTS = 32;
const MAX_PENDING_INPUTS = 120;

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
  private readonly pending: PendingInput[] = [];
  private predicted: PlayerState;
  private predictedBullets: PredictedBullet[] = [];
  private readonly snapshots: ReceivedSnapshot[] = [];
  private readonly placeholder: SimState;
  private remoteRender: PlayerState | null = null;
  private corrections = 0;
  private rejectedShots = 0;

  constructor(
    private readonly transport: Transport,
    local: CharacterId,
  ) {
    this.placeholder = createInitialState([local, local]);
    this.predicted = { ...this.placeholder.players[this.localId] };
    transport.send('event', encodeCharacter(local));
  }

  handleMessage(_channel: Channel, bytes: Uint8Array): void {
    const snapshot = decodeSnapshot(bytes);
    if (!snapshot) return;
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest && snapshot.state.tick <= latest.state.tick) return;
    this.snapshots.push({ state: snapshot.state, receivedAt: performance.now() });
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    this.reconcile(snapshot);
    this.reconcileBullets(snapshot);
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
    if (Math.hypot(replayed.x - this.predicted.x, replayed.y - this.predicted.y) > 0.5) this.corrections += 1;
    this.predicted = replayed;
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
      this.predictedBullets.push({ ...makeBullet(this.predicted, -this.localTick, this.localTick, 0), authTick: null });
    }

    const remote = this.remoteRender;
    this.predictedBullets = this.predictedBullets.filter((b) => {
      if (!advanceBullet(b)) return false;
      // 호스트가 되감기로 같은 시점을 판정하므로, 화면상 명중이면 미리 지운다.
      return !(remote && remote.hp > 0 && remote.dashTicks === 0 && bulletHits(b, remote.x, remote.y));
    });
  }

  renderState(nowMs: number): RenderState {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) {
      const players: [PlayerState, PlayerState] = [this.placeholder.players[0], this.predicted];
      return { tick: this.localTick, players, bullets: this.predictedBullets };
    }

    const estimatedHostTick = latest.state.tick + ((nowMs - latest.receivedAt) * SIM.tickRate) / 1000;
    const renderTick = estimatedHostTick - INTERP_DELAY_TICKS;
    const [from, to] = this.bracket(renderTick);
    const span = to.state.tick - from.state.tick;
    const t = span > 0 ? clamp01((renderTick - from.state.tick) / span) : 1;

    const remote = lerpPlayer(from.state.players[0], to.state.players[0], t);
    this.remoteRender = remote;
    const players: [PlayerState, PlayerState] = [remote, this.predicted];

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

    return { tick: latest.state.tick, players, bullets };
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

  winner(): 0 | 1 | null {
    const latest = this.snapshots[this.snapshots.length - 1];
    return latest ? winnerOf(latest.state) : null;
  }

  debugInfo(): string {
    return `snap ${this.snapshots.length} pending ${this.pending.length} fix ${this.corrections} shots ${this.predictedBullets.length} rejected ${this.rejectedShots}`;
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
