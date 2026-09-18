import type { Channel, Transport } from '../../net/transport';
import type { CharacterId } from '../../sim/characters';
import { createInitialState, setPlayerCharacter, step, winnerOf } from '../../sim/core';
import { PositionHistory } from '../../sim/history';
import { decodeCharacter, decodeInput, encodeCharacter, encodeSnapshot } from '../../sim/serialize';
import { EMPTY_INPUT, SIM, type InputFrame, type SimState } from '../../sim/types';
import { INTERP_DELAY_TICKS, monotonicTick, type GameSync, type RenderState } from './GameSync';

const SNAPSHOT_INTERVAL_TICKS = 3;
// 게스트 입력을 이 이상 쌓아두지 않는다 (60Hz 기준 100ms). 넘치면 오래된 것부터 버려 지연을 묶는다.
const MAX_QUEUED_INPUTS = 6;
// 게스트 탄환 판정 되감기 상한. 게스트는 RTT/2 + 보간 지연만큼 과거의 호스트를 보고 쏜다.
const MAX_LAG_TICKS = 12;

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
    private readonly transport: Transport,
    local: CharacterId,
  ) {
    this.state = createInitialState([local, local]);
    this.state.tick = monotonicTick();
    transport.send('event', encodeCharacter(local));
  }

  handleMessage(channel: Channel, bytes: Uint8Array): void {
    if (channel === 'event') {
      const character = decodeCharacter(bytes);
      if (character) setPlayerCharacter(this.state, 1, character);
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
      MAX_LAG_TICKS,
      Math.round((this.transport.rtt / 2 / 1000) * SIM.tickRate) + INTERP_DELAY_TICKS,
    );
    step(this.state, [local, this.lastGuestInput], {
      inputTicks: [this.state.tick + 1, this.ackTick],
      bulletLag: [0, this.lagTicks],
      history: this.history,
    });

    if (winnerOf(this.state) !== null) {
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

  winner(): 0 | 1 | null {
    return winnerOf(this.state);
  }

  debugInfo(): string {
    return `queue ${this.queue.length} drop ${this.droppedInputs} rewind ${this.lagTicks}t`;
  }
}
