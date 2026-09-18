export function xorshift32(x: number): number {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// 상태 안의 시드를 전진시키고 [0, 1) 난수를 돌려준다 (결정적).
export function nextRandom(state: { rngState: number }): number {
  state.rngState = xorshift32(state.rngState || 0x9e3779b9);
  return state.rngState / 0x100000000;
}

export class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  nextUint(): number {
    this.state = xorshift32(this.state);
    return this.state;
  }

  nextFloat(): number {
    return this.nextUint() / 0x100000000;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.nextFloat() * (maxExclusive - minInclusive));
  }
}
