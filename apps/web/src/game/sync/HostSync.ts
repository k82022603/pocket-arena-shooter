import type { Channel } from '../../net/transport';
import type { CharacterId } from '../../sim/characters';
import { createInitialState, outcomeOf, setPlayerCharacter, setPlayerLoadout, step, summarize, type MatchSummary, type Outcome } from '../../sim/core';
import type { WeaponKind } from '../../sim/weapons';
import { PositionHistory } from '../../sim/history';
import { decodeCharacter, decodeInput, encodeCharacter, encodeSnapshot } from '../../sim/serialize';
import { EMPTY_INPUT, SIM, type GameMode, type InputFrame, type SimState } from '../../sim/types';
import { INTERP_DELAY_TICKS, monotonicTick, type GameSync, type RenderState, type SyncLink } from './GameSync';
import type { SimEventSink } from '../../sim/events';

// 방을 만든 쪽(호스트): 권위를 가진다. 양쪽 입력으로 시뮬레이션을 돌리고 결과를 스냅샷으로 보낸다.

const SNAPSHOT_INTERVAL_TICKS = 3; // 3틱마다 = 초당 20번 스냅샷
// 게스트 입력을 이 이상 쌓아두지 않는다 (60Hz 기준 100ms). 넘치면 오래된 것부터 버려 지연을 묶는다.
const MAX_QUEUED_INPUTS = 6;
// 게스트 탄환 판정 되감기 상한. 게스트는 RTT/2 + 보간 지연만큼 과거의 호스트를 보고 쏜다.
// 대전(200ms): 이보다 길면 표적인 사람이 "엄폐한 뒤에 맞았다"고 느낀다.
// 협동(400ms): 표적이 AI 적이라 그런 불만이 없으므로 더 길게 되감아 게스트의 명중률을 지킨다.
// 400ms를 넘겨도 되지만 위치 히스토리가 64틱(약 1초)이므로 그 안에서 여유를 둔다.
const MAX_LAG_TICKS = 12;
const MAX_LAG_TICKS_COOP = 24;

interface QueuedInput {
  tick: number; // 참가자가 이 입력을 낸 틱
  frame: InputFrame;
}

export class HostSync implements GameSync {
  readonly kind = 'host' as const;
  readonly localId = 0 as const;

  private readonly state: SimState;
  private readonly history = new PositionHistory(); // 되감기 판정용 위치 기록
  private readonly queue: QueuedInput[] = []; // 도착했지만 아직 적용하지 않은 참가자 입력 (틱 순)
  private lastGuestInput: InputFrame = EMPTY_INPUT; // 입력이 비면 마지막 입력을 계속 쓴다
  private ackTick = 0; // 적용한 참가자 입력의 마지막 틱. 스냅샷에 실어 재조정 기준이 된다
  private lagTicks = 0; // 이번 틱의 참가자 탄 되감기 양
  private finished = false;
  private droppedInputs = 0; // 큐가 넘쳐 버린 입력 누적 (진단용)
  private sink: SimEventSink | null = null;

  constructor(
    private readonly transport: SyncLink,
    private readonly local: CharacterId,
    mode: GameMode,
    private readonly weapon: WeaponKind,
  ) {
    // 상대 파티마는 캐릭터 패킷이 오기 전까지 임시로 내 것과 같게 둔다
    this.state = createInitialState([local, local], { mode, playerCount: 2, seed: Date.now() });
    this.state.tick = monotonicTick(); // 재경기에도 틱 번호가 이전 경기보다 크게
    setPlayerLoadout(this.state, 0, weapon);
    transport.send('event', encodeCharacter(local, weapon)); // 내가 고른 것을 상대에게 알린다
  }

  setEventSink(sink: SimEventSink | null): void {
    this.sink = sink;
  }

  // 재접속 직후: 끊기기 전 입력을 버리고, 캐릭터와 지금 상태를 신뢰 채널로 다시 보낸다
  resync(): void {
    this.queue.length = 0;
    this.lastGuestInput = EMPTY_INPUT;
    this.transport.send('event', encodeCharacter(this.local, this.weapon));
    this.transport.send('event', encodeSnapshot(this.state, this.ackTick));
  }

  handleMessage(channel: Channel, bytes: Uint8Array): void {
    if (channel === 'event') {
      const choice = decodeCharacter(bytes); // 참가자가 고른 파티마와 무기
      if (choice) {
        setPlayerCharacter(this.state, 1, choice.character);
        setPlayerLoadout(this.state, 1, choice.weapon);
      }
      return;
    }
    const decoded = decodeInput(bytes);
    if (!decoded) return;
    for (const input of decoded) if (input.tick > this.ackTick) this.enqueue(input); // 이미 적용한 틱(중복 전송분)은 버린다
  }

  // 틱 순서를 지키며 끼워 넣는다. 같은 틱이 이미 있으면 버린다(중복 전송)
  private enqueue(input: QueuedInput): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.tick > input.tick) i -= 1;
    if (i > 0 && this.queue[i - 1]!.tick === input.tick) return;
    this.queue.splice(i, 0, input);
    // 너무 쌓이면 오래된 것부터 버린다. 호스트가 느려질 때 참가자가 되돌아가는(러버밴딩) 원인이 된다
    while (this.queue.length > MAX_QUEUED_INPUTS) {
      this.queue.shift();
      this.droppedInputs += 1;
    }
  }

  step(local: InputFrame): void {
    if (this.finished) return;
    const next = this.queue.shift(); // 한 틱에 참가자 입력 하나씩
    if (next) {
      this.lastGuestInput = next.frame;
      this.ackTick = next.tick;
    }
    // 되감기 양 = 편도 지연(RTT/2) + 참가자 화면의 보간 지연. 모드별 상한을 넘지 않는다
    this.lagTicks = Math.min(
      this.state.mode === 'coop' ? MAX_LAG_TICKS_COOP : MAX_LAG_TICKS,
      Math.round((this.transport.rtt / 2 / 1000) * SIM.tickRate) + INTERP_DELAY_TICKS,
    );
    step(this.state, [local, this.lastGuestInput], {
      inputTicks: [this.state.tick + 1, this.ackTick], // 탄의 spawnTick: 참가자 탄은 참가자의 입력 틱으로 (예측 탄과 대조하는 키)
      bulletLag: [0, this.lagTicks], // 내 탄은 되감지 않는다
      history: this.history,
      onEvent: this.sink ?? undefined,
    });

    if (outcomeOf(this.state) !== null) {
      this.finished = true;
      // 마지막 상태는 신뢰 채널로: 잃으면 참가자가 경기 끝을 모른다
      this.transport.send('event', encodeSnapshot(this.state, this.ackTick));
      return;
    }
    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.transport.send('input', encodeSnapshot(this.state, this.ackTick)); // 평소엔 지연 우선 채널: 잃어도 다음 것이 덮는다
    }
  }

  renderState(): RenderState {
    return this.state; // 호스트는 권위 상태를 그대로 그린다
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
