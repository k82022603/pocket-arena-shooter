import type { Channel } from '../../net/transport';
import type { CharacterId } from '../../sim/characters';
import { createInitialState, outcomeOf, setPlayerCharacter, setPlayerLoadout, step, summarize, type MatchSummary, type Outcome } from '../../sim/core';
import type { WeaponKind } from '../../sim/weapons';
import { PositionHistory } from '../../sim/history';
import { decodeCharacter, decodeInput, encodeCharacter, encodeSnapshot } from '../../sim/serialize';
import { EMPTY_INPUT, SIM, type GameMode, type InputFrame, type SimState } from '../../sim/types';
import { INTERP_DELAY_TICKS, monotonicTick, type GameSync, type RenderState, type SyncLink } from './GameSync';

const SNAPSHOT_INTERVAL_TICKS = 3;
// 게스트 입력을 이 이상 쌓아두지 않는다 (60Hz 기준 100ms). 넘치면 오래된 것부터 버려 지연을 묶는다.
const MAX_QUEUED_INPUTS = 6;
// 게스트 탄환 판정 되감기 상한. 게스트는 RTT/2 + 보간 지연만큼 과거의 호스트를 보고 쏜다.
// 대전(200ms): 이보다 길면 표적인 사람이 "엄폐한 뒤에 맞았다"고 느낀다.
// 협동(400ms): 표적이 AI 적이라 그런 불만이 없으므로 더 길게 되감아 게스트의 명중률을 지킨다.
// 400ms를 넘겨도 되지만 위치 히스토리가 64틱(약 1초)이므로 그 안에서 여유를 둔다.
const MAX_LAG_TICKS = 12;
const MAX_LAG_TICKS_COOP = 24;

interface QueuedInput {
  tick: number;
  frame: InputFrame;
}

export class HostSync implements GameSync {
  readonly kind = 'host' as const;
  readonly localId = 0 as const;

  private readonly state: SimState;
  private readonly history = new PositionHistory();
  private readonly queue: QueuedInput[] = [];
  private lastGuestInput: InputFrame = EMPTY_INPUT;
  private ackTick = 0;
  private lagTicks = 0;
  private finished = false;
  private droppedInputs = 0;

  constructor(
    private readonly transport: SyncLink,
    private readonly local: CharacterId,
    mode: GameMode,
    private readonly weapon: WeaponKind,
  ) {
    this.state = createInitialState([local, local], { mode, playerCount: 2, seed: Date.now() });
    this.state.tick = monotonicTick();
    setPlayerLoadout(this.state, 0, weapon);
    transport.send('event', encodeCharacter(local, weapon));
  }

  resync(): void {
    this.queue.length = 0;
    this.lastGuestInput = EMPTY_INPUT;
    this.transport.send('event', encodeCharacter(this.local, this.weapon));
    this.transport.send('event', encodeSnapshot(this.state, this.ackTick));
  }

  handleMessage(channel: Channel, bytes: Uint8Array): void {
    if (channel === 'event') {
      const choice = decodeCharacter(bytes);
      if (choice) {
        setPlayerCharacter(this.state, 1, choice.character);
        setPlayerLoadout(this.state, 1, choice.weapon);
      }
      return;
    }
    const decoded = decodeInput(bytes);
    if (!decoded) return;
    for (const input of decoded) if (input.tick > this.ackTick) this.enqueue(input);
  }

  private enqueue(input: QueuedInput): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.tick > input.tick) i -= 1;
    if (i > 0 && this.queue[i - 1]!.tick === input.tick) return;
    this.queue.splice(i, 0, input);
    while (this.queue.length > MAX_QUEUED_INPUTS) {
      this.queue.shift();
      this.droppedInputs += 1;
    }
  }

  step(local: InputFrame): void {
    if (this.finished) return;
    const next = this.queue.shift();
    if (next) {
      this.lastGuestInput = next.frame;
      this.ackTick = next.tick;
    }
    this.lagTicks = Math.min(
      this.state.mode === 'coop' ? MAX_LAG_TICKS_COOP : MAX_LAG_TICKS,
      Math.round((this.transport.rtt / 2 / 1000) * SIM.tickRate) + INTERP_DELAY_TICKS,
    );
    step(this.state, [local, this.lastGuestInput], {
      inputTicks: [this.state.tick + 1, this.ackTick],
      bulletLag: [0, this.lagTicks],
      history: this.history,
    });

    if (outcomeOf(this.state) !== null) {
      this.finished = true;
      this.transport.send('event', encodeSnapshot(this.state, this.ackTick));
      return;
    }
    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.transport.send('input', encodeSnapshot(this.state, this.ackTick));
    }
  }

  renderState(): RenderState {
    return this.state;
  }

  outcome(): Outcome | null {
    return outcomeOf(this.state);
  }

  summary(): MatchSummary {
    return summarize(this.state);
  }

  debugInfo(): string {
    return `queue ${this.queue.length} drop ${this.droppedInputs} rewind ${this.lagTicks}t`;
  }
}
