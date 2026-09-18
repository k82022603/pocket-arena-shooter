import type { Channel, Transport } from '../../net/transport';
import type { CharacterId } from '../../sim/characters';
import { applyPlayerInput, createInitialState, winnerOf } from '../../sim/core';
import { decodeSnapshot, encodeCharacter, encodeInput, type Snapshot } from '../../sim/serialize';
import { SIM, type BulletState, type InputFrame, type PlayerState, type SimState } from '../../sim/types';
import { monotonicTick, type GameSync, type RenderState } from './GameSync';

// 상대·탄환은 최신 스냅샷보다 이만큼 과거 시점을 보간해서 그린다 (60Hz 기준 100ms).
const INTERP_DELAY_TICKS = 6;
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

export class GuestSync implements GameSync {
  readonly kind = 'guest' as const;
  readonly localId = 1 as const;

  private localTick = monotonicTick();
  private readonly pending: PendingInput[] = [];
  private predicted: PlayerState;
  private readonly snapshots: ReceivedSnapshot[] = [];
  private readonly placeholder: SimState;
  private corrections = 0;

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
  }

  private reconcile(snapshot: Snapshot): void {
    const authoritative = snapshot.state.players[this.localId];
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.tick <= snapshot.ackTick) drop += 1;
    this.pending.splice(0, drop);

    const replayed: PlayerState = { ...authoritative };
    for (const input of this.pending) applyPlayerInput(replayed, input.frame);
    if (Math.hypot(replayed.x - this.predicted.x, replayed.y - this.predicted.y) > 0.5) this.corrections += 1;
    this.predicted = replayed;
  }

  step(local: InputFrame): void {
    this.localTick += 1;
    this.transport.send('input', encodeInput(this.localTick, local));
    this.pending.push({ tick: this.localTick, frame: local });
    if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
    applyPlayerInput(this.predicted, local);
  }

  renderState(nowMs: number): RenderState {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) {
      const players: [PlayerState, PlayerState] = [this.placeholder.players[0], this.predicted];
      return { tick: this.localTick, players, bullets: [] };
    }

    const estimatedHostTick = latest.state.tick + ((nowMs - latest.receivedAt) * SIM.tickRate) / 1000;
    const renderTick = estimatedHostTick - INTERP_DELAY_TICKS;
    const [from, to] = this.bracket(renderTick);
    const span = to.state.tick - from.state.tick;
    const t = span > 0 ? clamp01((renderTick - from.state.tick) / span) : 1;

    const remote = lerpPlayer(from.state.players[0], to.state.players[0], t);
    const players: [PlayerState, PlayerState] = [remote, this.predicted];

    const fromBullets = new Map<number, BulletState>();
    for (const b of from.state.bullets) fromBullets.set(b.id, b);
    const bullets = to.state.bullets.map((b) => {
      const prev = fromBullets.get(b.id);
      return prev ? { ...b, x: lerp(prev.x, b.x, t), y: lerp(prev.y, b.y, t) } : b;
    });

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
    return `snap ${this.snapshots.length} pending ${this.pending.length} fix ${this.corrections}`;
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
