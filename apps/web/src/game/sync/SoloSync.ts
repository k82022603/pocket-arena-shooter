import { characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import { botInput, createBotMemory, type BotMemory } from '../../sim/bot';
import { createInitialState, outcomeOf, setPlayerLoadout, step, summarize, type MatchSummary, type Outcome } from '../../sim/core';
import { nextRandom } from '../../sim/prng';
import { EMPTY_INPUT, type GameMode, type InputFrame, type SimState } from '../../sim/types';
import { LOADOUTS, type WeaponKind } from '../../sim/weapons';
import type { GameSync, RenderState } from './GameSync';

export class SoloSync implements GameSync {
  readonly kind = 'solo' as const;
  readonly localId = 0 as const;
  private readonly state: SimState;
  private readonly bot: BotMemory = createBotMemory();

  constructor(local: CharacterId, mode: GameMode, weapon: WeaponKind) {
    const foe = characterAt(characterIndex(local) + 1);
    this.state = createInitialState([local, foe], {
      mode,
      playerCount: mode === 'coop' ? 1 : 2,
      seed: Date.now(),
    });
    setPlayerLoadout(this.state, 0, weapon);
    // 봇은 자기 파티마의 선택지 중 하나를 무작위로 든다
    const options = LOADOUTS[foe];
    setPlayerLoadout(this.state, 1, options[Math.floor(nextRandom(this.state) * options.length)]!);
  }

  step(local: InputFrame): void {
    // 1:1 대전에서는 상대를 AI가 조종한다. 협동은 1인 방어라 두 번째 슬롯이 비어 있다.
    const foe = this.state.mode === 'duel' ? botInput(this.state, 1, this.bot) : EMPTY_INPUT;
    step(this.state, [local, foe]);
  }

  handleMessage(): void {}

  renderState(): RenderState {
    return this.state;
  }

  outcome(): Outcome | null {
    return outcomeOf(this.state);
  }

  summary(): MatchSummary {
    return summarize(this.state);
  }

  resync(): void {}

  debugInfo(): string {
    return '';
  }
}
