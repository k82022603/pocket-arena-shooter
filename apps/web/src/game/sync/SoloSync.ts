import { characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import { createInitialState, outcomeOf, step, summarize, type MatchSummary, type Outcome } from '../../sim/core';
import { EMPTY_INPUT, type GameMode, type InputFrame, type SimState } from '../../sim/types';
import type { GameSync, RenderState } from './GameSync';

export class SoloSync implements GameSync {
  readonly kind = 'solo' as const;
  readonly localId = 0 as const;
  private readonly state: SimState;

  constructor(local: CharacterId, mode: GameMode) {
    this.state = createInitialState([local, characterAt(characterIndex(local) + 1)], {
      mode,
      playerCount: mode === 'coop' ? 1 : 2,
      seed: Date.now(),
    });
  }

  step(local: InputFrame): void {
    step(this.state, [local, EMPTY_INPUT]);
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
