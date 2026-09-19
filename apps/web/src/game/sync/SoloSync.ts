import { characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import { botInput, createBotMemory, type BotMemory } from '../../sim/bot';
import { createInitialState, outcomeOf, setPlayerLoadout, step, summarize, type MatchSummary, type Outcome } from '../../sim/core';
import { nextRandom } from '../../sim/prng';
import { EMPTY_INPUT, type GameMode, type InputFrame, type SimState } from '../../sim/types';
import { LOADOUTS, type WeaponKind } from '../../sim/weapons';
import type { GameSync, RenderState } from './GameSync';
import type { SimEventSink } from '../../sim/events';
import { BOT_SKILL, type BotSkill, type Difficulty } from '../../sim/difficulty';

// 혼자 하기: 네트워크 없이 이 기기에서 시뮬레이션을 직접 돌린다. 대전이면 상대는 봇이다.
export class SoloSync implements GameSync {
  readonly kind = 'solo' as const;
  readonly localId = 0 as const;
  private readonly state: SimState;
  private readonly bot: BotMemory = createBotMemory(); // 봇의 틱 사이 기억
  private sink: SimEventSink | null = null;

  private readonly skill: BotSkill; // 난이도에 따른 봇 솜씨

  constructor(local: CharacterId, mode: GameMode, weapon: WeaponKind, difficulty: Difficulty = 'normal') {
    this.skill = BOT_SKILL[difficulty];
    const foe = characterAt(characterIndex(local) + 1); // 상대(봇)는 목록에서 내 다음 파티마
    this.state = createInitialState([local, foe], {
      mode,
      playerCount: mode === 'coop' ? 1 : 2, // 협동은 1인 방어, 대전은 봇까지 2명
      seed: Date.now(), // 매번 다른 경기
      difficulty,
    });
    setPlayerLoadout(this.state, 0, weapon);
    // 봇은 자기 파티마의 선택지 중 하나를 무작위로 든다
    const options = LOADOUTS[foe];
    setPlayerLoadout(this.state, 1, options[Math.floor(nextRandom(this.state) * options.length)]!);
  }

  step(local: InputFrame): void {
    // 1:1 대전에서는 상대를 AI가 조종한다. 협동은 1인 방어라 두 번째 슬롯이 비어 있다.
    const foe = this.state.mode === 'duel' ? botInput(this.state, 1, this.bot, this.skill) : EMPTY_INPUT;
    step(this.state, [local, foe], { onEvent: this.sink ?? undefined });
  }

  handleMessage(): void {} // 받을 패킷이 없다

  renderState(): RenderState {
    return this.state; // 보간할 필요 없이 시뮬레이션 상태가 곧 화면이다
  }

  outcome(): Outcome | null {
    return outcomeOf(this.state);
  }

  summary(): MatchSummary {
    return summarize(this.state);
  }

  setEventSink(sink: SimEventSink | null): void {
    this.sink = sink;
  }

  resync(): void {} // 끊길 연결이 없다

  debugInfo(): string {
    return '';
  }
}
