import { characterAt, characterIndex, type CharacterId } from '../../sim/characters';
import { createInitialState, step, winnerOf } from '../../sim/core';
import { EMPTY_INPUT, type InputFrame, type SimState } from '../../sim/types';
import type { GameSync, RenderState } from './GameSync';

export class SoloSync implements GameSync {
  readonly kind = 'solo' as const;
  readonly localId = 0 as const;
  private readonly state: SimState;

  constructor(local: CharacterId) {
    this.state = createInitialState([local, characterAt(characterIndex(local) + 1)]);
  }

  step(local: InputFrame): void {
    step(this.state, [local, EMPTY_INPUT]);
  }

  handleMessage(): void {}

  renderState(): RenderState {
    return this.state;
  }

  winner(): 0 | 1 | null {
    return winnerOf(this.state);
  }

  debugInfo(): string {
    return '';
  }
}
